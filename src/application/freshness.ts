import {
  PROMPT_VERSION,
  type DocRecord,
  type SourceFile,
} from "../domain/model.js";
import { dependencyContext } from "../infrastructure/source/context.js";
import { hash, safeRead } from "../infrastructure/source/files.js";

// Freshness is defined once here: source text hash + direct dependency fingerprint + prompt version
// + the configured model, so switching models marks earlier explanations for regeneration.
export async function snapshot(
  root: string,
  files: SourceFile[],
  path: string,
) {
  const source = await safeRead(root, path);
  const deps = await dependencyContext(root, files, path, source);
  return { source, hash: hash(source), deps };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export function isFresh(
  d: DocRecord | undefined,
  s: Snapshot,
  model: string,
): boolean {
  return Boolean(
    d &&
    d.hash === s.hash &&
    d.context === s.deps.fingerprint &&
    d.version === PROMPT_VERSION &&
    // With no model configured nothing can be regenerated, so keep showing what exists.
    (!model || d.model === model),
  );
}

/** Snapshot-or-undefined: unreadable sources (moved, too large, non UTF-8) are not fresh. */
export async function trySnapshot(
  root: string,
  files: SourceFile[],
  path: string,
): Promise<Snapshot | undefined> {
  try {
    return await snapshot(root, files, path);
  } catch {
    return undefined;
  }
}
