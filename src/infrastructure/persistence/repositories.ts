import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  DocRecord,
  Job,
  Project,
  SourceFile,
} from "../../domain/model.js";
import type { JobKind, JobState } from "../../shared/api.js";
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
      for (const table of ["files", "docs", "jobs"])
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

export class DocumentRepository {
  constructor(private db: DatabaseSync) {}
  get(project: string, path: string): DocRecord | undefined {
    return this.db
      .prepare("SELECT * FROM docs WHERE project=? AND path=?")
      .get(project, path) as unknown as DocRecord | undefined;
  }
  listByProject(project: string): Map<string, DocRecord> {
    const rows = this.db
      .prepare("SELECT * FROM docs WHERE project=?")
      .all(project) as unknown as DocRecord[];
    return new Map(rows.map((d) => [d.path, d]));
  }
  save(doc: Omit<DocRecord, "review">) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO docs(project,path,hash,context,version,model,markdown,payload,generated,review) VALUES(?,?,?,?,?,?,?,?,?,NULL)",
      )
      .run(
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
  saveReview(project: string, path: string, generated: string, review: string) {
    this.db
      .prepare(
        "UPDATE docs SET review=? WHERE project=? AND path=? AND generated=?",
      )
      .run(review, project, path, generated);
  }
}

export class JobRepository {
  constructor(private db: DatabaseSync) {}
  /** Returns 1 if queued, 0 if an identical job is already active. */
  enqueue(project: string, path: string, kind: JobKind = "generate"): number {
    const t = now();
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,project,path,kind,state,created,updated) VALUES(?,?,?,?,'queued',?,?)",
      )
      .run(randomUUID(), project, path, kind, t, t);
    return Number(result.changes);
  }
  get(id: string): Job | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      Job | undefined;
  }
  recent(limit = 200): Job[] {
    return this.db
      .prepare("SELECT * FROM jobs ORDER BY created DESC LIMIT ?")
      .all(limit) as unknown as Job[];
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
