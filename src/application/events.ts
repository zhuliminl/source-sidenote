import { EventEmitter } from "node:events";

export type ChangeTopic = "projects" | "topics" | "jobs" | "config";

/** In-process notifications: the worker listens for new jobs, SSE clients for any change. */
export class AppEvents extends EventEmitter<{
  change: [topic: ChangeTopic];
}> {
  constructor() {
    super();
    // One listener per open browser tab and editor plugin, plus the worker: more than
    // Node's default warning threshold of 10 is normal here.
    this.setMaxListeners(100);
  }
  changed(topic: ChangeTopic) {
    this.emit("change", topic);
  }
}
