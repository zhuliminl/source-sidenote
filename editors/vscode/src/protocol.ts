// Messages between the extension host and the explanation webview (type-only).
import type { DocumentView, JobView } from "../../../src/shared/api";

export interface TopicRef {
  id: string;
  title: string;
}

export type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; file: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; file?: string; message: string }
  /** Not in a registered project, outside its scan scope, or in no topic yet. */
  | {
      kind: "untracked";
      file: string;
      message: string;
      /** Set when the project is known, so the panel can link to creating a topic. */
      project: TopicRef | null;
    }
  | {
      kind: "document";
      file: string;
      project: TopicRef;
      topic: TopicRef;
      /** Every topic that covers this file, for switching. */
      topics: TopicRef[];
      /** Why the planner put this file in the topic. */
      reason: string;
      doc: DocumentView;
      /** Latest generate/review job for this file in this topic, if any. */
      job: JobView | null;
      /** Editor buffer has unsaved changes; explanations describe the saved file. */
      dirty: boolean;
      /** Reason the last request could not be queued. */
      blocked: string | null;
    };

export type ToWebview =
  | { type: "state"; state: PanelState }
  /** The evidence entry covering the editor cursor (index into evidence), or null. */
  | { type: "active"; index: number | null };

export type FromWebview =
  | { type: "ready" }
  | { type: "reveal"; start: number; end: number }
  | { type: "open"; path: string }
  | { type: "generate" }
  | { type: "review" }
  | { type: "web" }
  | { type: "chooseTopic" }
  | { type: "newTopic" };
