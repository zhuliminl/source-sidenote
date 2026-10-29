import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// Append-only: each entry upgrades the schema by one user_version.
const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, root TEXT UNIQUE, name TEXT, created TEXT);
   CREATE TABLE IF NOT EXISTS files(project TEXT, path TEXT, hash TEXT, bytes INTEGER, PRIMARY KEY(project,path));
   CREATE TABLE IF NOT EXISTS docs(project TEXT, path TEXT, hash TEXT, context TEXT, version TEXT, model TEXT, markdown TEXT, payload TEXT, generated TEXT, review TEXT, PRIMARY KEY(project,path));
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project TEXT, path TEXT, kind TEXT, state TEXT, attempts INTEGER DEFAULT 0, error TEXT, created TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS one_active ON jobs(project,path,kind) WHERE state IN ('queued','running');`,
  `ALTER TABLE jobs ADD COLUMN updated TEXT;
   CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state, created);`,
  // Topics replace whole-project coverage; file-level explanations from v2 are not carried over.
  `CREATE TABLE topics(id TEXT PRIMARY KEY, project TEXT, title TEXT, request TEXT, instructions TEXT, state TEXT, plan TEXT, error TEXT, model TEXT, overview TEXT, created TEXT);
   CREATE INDEX topics_project ON topics(project, created);
   CREATE TABLE topic_files(topic TEXT, path TEXT, ord INTEGER, reason TEXT, PRIMARY KEY(topic,path));
   DROP TABLE docs;
   CREATE TABLE docs(topic TEXT, project TEXT, path TEXT, hash TEXT, context TEXT, version TEXT, model TEXT, markdown TEXT, payload TEXT, generated TEXT, review TEXT, PRIMARY KEY(topic,path));
   CREATE INDEX docs_project ON docs(project, path);
   DELETE FROM jobs;
   ALTER TABLE jobs ADD COLUMN topic TEXT NOT NULL DEFAULT '';
   DROP INDEX one_active;
   CREATE UNIQUE INDEX one_active ON jobs(topic,path,kind) WHERE state IN ('queued','running');`,
  // Each topic picks its own model; existing topics keep following the default model.
  `ALTER TABLE topics ADD COLUMN provider TEXT;`,
  // Stories: recorded walks through a topic's code, one per question.
  `CREATE TABLE stories(id TEXT PRIMARY KEY, topic TEXT, project TEXT, question TEXT, title TEXT, state TEXT, error TEXT, provider TEXT, model TEXT, steps TEXT, created TEXT);
   CREATE INDEX stories_topic ON stories(topic, created);`,
];

export function openDatabase(home: string): DatabaseSync {
  const file = join(home, "state.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let v = current; v < migrations.length; v++)
    transaction(db, () => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version=${v + 1}`);
    });
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
