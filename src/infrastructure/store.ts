import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chmodSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import {
  defaults,
  type ModelConfig,
  type Project,
  type SourceFile,
} from "../domain/types.js";
export class Store {
  db: DatabaseSync;
  constructor(public home: string) {
    this.db = new DatabaseSync(join(home, "state.sqlite"));
    chmodSync(join(home, "state.sqlite"), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, root TEXT UNIQUE, name TEXT, created TEXT);
      CREATE TABLE IF NOT EXISTS files(project TEXT, path TEXT, hash TEXT, bytes INTEGER, PRIMARY KEY(project,path));
      CREATE TABLE IF NOT EXISTS docs(project TEXT, path TEXT, hash TEXT, context TEXT, version TEXT, model TEXT, markdown TEXT, payload TEXT, generated TEXT, review TEXT, PRIMARY KEY(project,path));
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project TEXT, path TEXT, kind TEXT, state TEXT, attempts INTEGER DEFAULT 0, error TEXT, created TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active ON jobs(project,path,kind) WHERE state IN ('queued','running');
      PRAGMA user_version=1;`);
    this.db.exec("UPDATE jobs SET state='queued' WHERE state='running'");
  }
  config(): ModelConfig {
    try {
      return {
        ...defaults,
        ...JSON.parse(readFileSync(join(this.home, "config.json"), "utf8")),
      };
    } catch {
      return { ...defaults };
    }
  }
  saveConfig(c: ModelConfig) {
    const path = join(this.home, "config.json");
    writeFileSync(path + ".tmp", JSON.stringify(c, null, 2), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  }
  register(root: string, name: string): Project {
    this.db
      .prepare("INSERT OR IGNORE INTO projects VALUES(?,?,?,?)")
      .run(randomUUID(), root, name, new Date().toISOString());
    return this.db
      .prepare("SELECT * FROM projects WHERE root=?")
      .get(root) as unknown as Project;
  }
  project(id: string): Project {
    const p = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!p) throw new Error("Project not found");
    return p as unknown as Project;
  }
  files(id: string): SourceFile[] {
    return this.db
      .prepare(
        "SELECT path,hash,bytes FROM files WHERE project=? ORDER BY path",
      )
      .all(id) as unknown as SourceFile[];
  }
  sync(id: string, files: SourceFile[]) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM files WHERE project=?").run(id);
      const insert = this.db.prepare("INSERT INTO files VALUES(?,?,?,?)");
      for (const f of files) insert.run(id, f.path, f.hash, f.bytes);
      this.db
        .prepare(
          "DELETE FROM docs WHERE project=? AND path NOT IN (SELECT path FROM files WHERE project=?)",
        )
        .run(id, id);
      this.db
        .prepare(
          "UPDATE jobs SET state='cancelled' WHERE project=? AND state='queued' AND path NOT IN (SELECT path FROM files WHERE project=?)",
        )
        .run(id, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  doc(id: string, path: string): any {
    return this.db
      .prepare("SELECT * FROM docs WHERE project=? AND path=?")
      .get(id, path);
  }
  enqueue(id: string, path: string, kind = "generate") {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,project,path,kind,state,created) VALUES(?,?,?,?,'queued',?)",
      )
      .run(randomUUID(), id, path, kind, new Date().toISOString());
    return Number(result.changes);
  }
  jobs() {
    return this.db
      .prepare("SELECT * FROM jobs ORDER BY created DESC LIMIT 200")
      .all();
  }
  close() {
    this.db.close();
  }
}
