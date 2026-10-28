import { readFile, realpath, lstat } from "node:fs/promises";
import { join, relative, sep, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { MAX_SOURCE_BYTES } from "../../domain/model.js";
import { badRequest } from "../../domain/errors.js";

export const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");

// Non-UTF-8 sources (e.g. GBK) are skipped: lossy decoding would make text and byte hashes disagree.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function decodeUtf8(data: Buffer): string | undefined {
  try {
    return utf8.decode(data);
  } catch {
    return undefined;
  }
}

/** Reads a project-relative file, refusing anything that resolves outside the root. */
export async function safeRead(root: string, path: string): Promise<string> {
  root = await realpath(root);
  const target = await realpath(join(root, path));
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw badRequest("Path outside project");
  const info = await lstat(target);
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES)
    throw badRequest("Source exceeds 128 KiB limit");
  const text = decodeUtf8(await readFile(target));
  if (text === undefined) throw badRequest("Source is not valid UTF-8");
  return text;
}
