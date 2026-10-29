import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  DocRecord,
  Job,
  Project,
  SourceFile,
  Story,
  Topic,
  TopicFileRecord,
} from "../../domain/model.js";
import type { JobKind, JobState, TopicState } from "../../shared/api.js";
import { notFound } from "../../domain/errors.js";
import { transaction } from "./database.js";

const now = () => new Date().toISOString();

export class ProjectRepository {
  constructor(private db: DatabaseSync) {}
  register(root: string, name: string): Project {
    this.db
      .prepare("INSERT OR IGNORE INTO projects VALUES(?,?,?,?)")
      .run(randomUUID(), root, name, now());
    return this.db
      .prepare("SELECT * FROM projects WHERE root=?")
      .get(root) as unknown as Project;
  }
  get(id: string): Project {
    const p = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!p) throw notFound("Project not found");
    return p as unknown as Project;
  }
  list(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY created DESC")
      .all() as unknown as Project[];
  }
  remove(id: string) {
    transaction(this.db, () => {
      this.db
        .prepare(
          "DELETE FROM topic_files WHERE topic IN (SELECT id FROM topics WHERE project=?)",
        )
        .run(id);
      for (const table of ["files", "docs", "jobs", "stories", "topics"])
        this.db.prepare(`DELETE FROM ${table} WHERE project=?`).run(id);
      this.db.prepare("DELETE FROM projects WHERE id=?").run(id);
    });
  }
}

export class FileRepository {
  constructor(private db: DatabaseSync) {}
  list(project: string): SourceFile[] {
    return this.db
      .prepare(
        "SELECT path,hash,bytes FROM files WHERE project=? ORDER BY path",
      )
      .all(project) as unknown as SourceFile[];
  }
  /** Replaces the file manifest and drops docs/queued jobs for files that left scope. */
  replace(project: string, files: SourceFile[]) {
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM files WHERE project=?").run(project);
      const insert = this.db.prepare("INSERT INTO files VALUES(?,?,?,?)");
      for (const f of files) insert.run(project, f.path, f.hash, f.bytes);
      const outOfScope = "path NOT IN (SELECT path FROM files WHERE project=?)";
      this.db
        .prepare(`DELETE FROM docs WHERE project=? AND ${outOfScope}`)
        .run(project, project);
      this.db
        .prepare(
          `UPDATE jobs SET state='cancelled',updated=? WHERE project=? AND state='queued' AND ${outOfScope}`,
        )
        .run(now(), project, project);
    });
  }
}

export class TopicRepository {
  constructor(private db: DatabaseSync) {}
  create(
    t: Pick<
      Topic,
      "project" | "title" | "request" | "instructions" | "provider" | "model"
    >,
  ): Topic {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO topics(id,project,title,request,instructions,state,plan,error,provider,model,overview,created) VALUES(?,?,?,?,?,'planning','',NULL,?,?,NULL,?)",
      )
      .run(
        id,
        t.project,
        t.title,
        t.request,
        t.instructions,
        t.provider,
        t.model,
        now(),
      );
    return this.get(id);
  }
  get(id: string): Topic {
    const t = this.db.prepare("SELECT * FROM topics WHERE id=?").get(id);
    if (!t) throw notFound("Topic not found");
    return t as unknown as Topic;
  }
  find(id: string): Topic | undefined {
    return this.db.prepare("SELECT * FROM topics WHERE id=?").get(id) as
      Topic | undefined;
  }
  list(project: string): Topic[] {
    return this.db
      .prepare("SELECT * FROM topics WHERE project=? ORDER BY created DESC")
      .all(project) as unknown as Topic[];
  }
  update(
    id: string,
    fields: Partial<
      Pick<
        Topic,
        | "title"
        | "instructions"
        | "plan"
        | "error"
        | "provider"
        | "model"
        | "overview"
      > & { state: TopicState }
    >,
  ) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.db
      .prepare(
        `UPDATE topics SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
      )
      .run(...keys.map((k) => (fields as any)[k] ?? null), id);
  }
  files(topic: string): TopicFileRecord[] {
    return this.db
      .prepare("SELECT * FROM topic_files WHERE topic=? ORDER BY ord")
      .all(topic) as unknown as TopicFileRecord[];
  }
  /** Topic ids per path, for the coverage view. */
  coverage(project: string): Map<string, string[]> {
    const rows = this.db
      .prepare(
        "SELECT f.path, f.topic FROM topic_files f JOIN topics t ON t.id=f.topic WHERE t.project=? AND t.state='confirmed' ORDER BY t.created",
      )
      .all(project) as { path: string; topic: string }[];
    const map = new Map<string, string[]>();
    for (const r of rows)
      map.set(r.path, [...(map.get(r.path) ?? []), r.topic]);
    return map;
  }
  setFiles(topic: string, files: { path: string; reason: string }[]) {
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM topic_files WHERE topic=?").run(topic);
      const insert = this.db.prepare(
        "INSERT INTO topic_files(topic,path,ord,reason) VALUES(?,?,?,?)",
      );
      files.forEach((f, i) => insert.run(topic, f.path, i, f.reason));
    });
  }
  /** Removes the topic with everything generated for it and cancels its pending work. */
  /** Drops what was generated for a topic (explanations, walkthrough, stories) but keeps its files. */
  clearContent(id: string) {
    return transaction(this.db, () => {
      const docs = Number(
        this.db.prepare("DELETE FROM docs WHERE topic=?").run(id).changes,
      );
      const stories = Number(
        this.db.prepare("DELETE FROM stories WHERE topic=?").run(id).changes,
      );
      this.db
        .prepare(
          "UPDATE jobs SET state='cancelled',updated=? WHERE topic=? AND state IN ('queued','running')",
        )
        .run(now(), id);
      this.db.prepare("UPDATE topics SET overview=NULL WHERE id=?").run(id);
      return { docs, stories };
    });
  }
  /** Every topic id, across all projects. */
  ids(): string[] {
    return (
      this.db.prepare("SELECT id FROM topics").all() as { id: string }[]
    ).map((r) => r.id);
  }
  remove(id: string) {
    transaction(this.db, () => {
      for (const table of ["topic_files", "docs", "stories"])
        this.db.prepare(`DELETE FROM ${table} WHERE topic=?`).run(id);
      this.db
        .prepare(
          "UPDATE jobs SET state='cancelled',updated=? WHERE topic=? AND state IN ('queued','running')",
        )
        .run(now(), id);
      this.db.prepare("DELETE FROM topics WHERE id=?").run(id);
    });
  }
}

export class StoryRepository {
  constructor(private db: DatabaseSync) {}
  create(
    s: Pick<Story, "topic" | "project" | "question" | "provider" | "model">,
  ): Story {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO stories(id,topic,project,question,title,state,error,provider,model,steps,created) VALUES(?,?,?,?,?,'generating',NULL,?,?,'[]',?)",
      )
      .run(
        id,
        s.topic,
        s.project,
        s.question,
        s.question.slice(0, 40),
        s.provider,
        s.model,
        now(),
      );
    return this.get(id);
  }
  get(id: string): Story {
    const s = this.find(id);
    if (!s) throw notFound("Story not found");
    return s;
  }
  find(id: string): Story | undefined {
    return this.db.prepare("SELECT * FROM stories WHERE id=?").get(id) as
      Story | undefined;
  }
  list(topic: string): Story[] {
    return this.db
      .prepare("SELECT * FROM stories WHERE topic=? ORDER BY created")
      .all(topic) as unknown as Story[];
  }
  update(
    id: string,
    fields: Partial<
      Pick<Story, "title" | "state" | "error" | "provider" | "model" | "steps">
    >,
  ) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.db
      .prepare(
        `UPDATE stories SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
      )
      .run(...keys.map((k) => (fields as any)[k] ?? null), id);
  }
  remove(id: string) {
    transaction(this.db, () => {
      this.db
        .prepare(
          "UPDATE jobs SET state='cancelled',updated=? WHERE kind='story' AND path=? AND state IN ('queued','running')",
        )
        .run(now(), id);
      this.db.prepare("DELETE FROM stories WHERE id=?").run(id);
    });
  }
}

export class DocumentRepository {
  constructor(private db: DatabaseSync) {}
  get(topic: string, path: string): DocRecord | undefined {
    return this.db
      .prepare("SELECT * FROM docs WHERE topic=? AND path=?")
      .get(topic, path) as unknown as DocRecord | undefined;
  }
  listByTopic(topic: string): Map<string, DocRecord> {
    const rows = this.db
      .prepare("SELECT * FROM docs WHERE topic=?")
      .all(topic) as unknown as DocRecord[];
    return new Map(rows.map((d) => [d.path, d]));
  }
  save(doc: Omit<DocRecord, "review">) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO docs(topic,project,path,hash,context,version,model,markdown,payload,generated,review) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)",
      )
      .run(
        doc.topic,
        doc.project,
        doc.path,
        doc.hash,
        doc.context,
        doc.version,
        doc.model,
        doc.markdown,
        doc.payload,
        doc.generated,
      );
  }
  /** Only attaches the review if the doc was not regenerated meanwhile. */
  saveReview(topic: string, path: string, generated: string, review: string) {
    this.db
      .prepare(
        "UPDATE docs SET review=? WHERE topic=? AND path=? AND generated=?",
      )
      .run(review, topic, path, generated);
  }
}

export class JobRepository {
  constructor(private db: DatabaseSync) {}
  /** Returns 1 if queued, 0 if an identical job is already active. */
  enqueue(
    project: string,
    topic: string,
    path: string,
    kind: JobKind = "generate",
  ): number {
    const t = now();
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,project,topic,path,kind,state,created,updated) VALUES(?,?,?,?,?,'queued',?,?)",
      )
      .run(randomUUID(), project, topic, path, kind, t, t);
    return Number(result.changes);
  }
  get(id: string): Job | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      Job | undefined;
  }
  recent(limit = 200): (Job & { topicTitle: string | null })[] {
    return this.db
      .prepare(
        "SELECT j.*, t.title AS topicTitle FROM jobs j LEFT JOIN topics t ON t.id=j.topic ORDER BY j.created DESC LIMIT ?",
      )
      .all(limit) as unknown as (Job & { topicTitle: string | null })[];
  }
  /** Jobs of one topic that have not finished yet. */
  pending(topic: string): Job[] {
    return this.db
      .prepare(
        "SELECT * FROM jobs WHERE topic=? AND state IN ('queued','running')",
      )
      .all(topic) as unknown as Job[];
  }
  /** Atomically claims the oldest queued job. */
  claimNext(): Job | undefined {
    return this.db
      .prepare(
        `UPDATE jobs SET state='running',attempts=attempts+1,error=NULL,updated=?
         WHERE id=(SELECT id FROM jobs WHERE state='queued' ORDER BY created LIMIT 1)
         RETURNING *`,
      )
      .get(now()) as unknown as Job | undefined;
  }
  finish(id: string, state: JobState, error: string | null = null) {
    this.db
      .prepare("UPDATE jobs SET state=?,error=?,updated=? WHERE id=?")
      .run(state, error, now(), id);
  }
  cancelQueued(id: string) {
    this.db
      .prepare(
        "UPDATE jobs SET state='cancelled',updated=? WHERE id=? AND state='queued'",
      )
      .run(now(), id);
  }
  /** After a crash, running jobs have no worker; put them back in the queue. */
  requeueInterrupted() {
    this.db
      .prepare("UPDATE jobs SET state='queued',updated=? WHERE state='running'")
      .run(now());
  }
  /** Keeps the newest finished jobs so the table does not grow without bound. */
  pruneFinished(keep = 1000) {
    this.db
      .prepare(
        `DELETE FROM jobs WHERE state IN ('done','failed','cancelled') AND id NOT IN
         (SELECT id FROM jobs WHERE state IN ('done','failed','cancelled') ORDER BY created DESC LIMIT ?)`,
      )
      .run(keep);
  }
}
