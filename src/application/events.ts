import { EventEmitter } from "node:events";

export type ChangeTopic = "projects" | "topics" | "jobs" | "config";

/** In-process notifications: the worker listens for new jobs, SSE clients for any change. */
export class AppEvents extends EventEmitter<{
  change: [topic: ChangeTopic];
}> {
  changed(topic: ChangeTopic) {
    this.emit("change", topic);
  }
}
