import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../infrastructure/persistence/database.js";
import { ConfigStore } from "../infrastructure/persistence/config-store.js";
import {
  DocumentRepository,
  FileRepository,
  JobRepository,
  ProjectRepository,
} from "../infrastructure/persistence/repositories.js";
import { AppEvents } from "./events.js";
import { ProjectService } from "./project-service.js";
import { ConfigService } from "./config-service.js";
import { JobWorker } from "./job-worker.js";

/** Composition root: wires repositories and services for one data directory. */
export function createContainer(home: string) {
  const db: DatabaseSync = openDatabase(home);
  const events = new AppEvents();
  const deps = {
    projects: new ProjectRepository(db),
    files: new FileRepository(db),
    docs: new DocumentRepository(db),
    jobs: new JobRepository(db),
    config: new ConfigStore(home),
    events,
  };
  return {
    db,
    ...deps,
    projectService: new ProjectService(deps),
    configService: new ConfigService(deps.config, events),
    worker: new JobWorker(deps),
    close: () => db.close(),
  };
}
export type Container = ReturnType<typeof createContainer>;
