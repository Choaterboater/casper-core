import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { isSecretFile } from "../secrets/files";
import { HASH_LIMIT, snapshotTree } from "../task/changes";
import { UndoStore } from "../task/undo";
import type { ChangeBaseline } from "./proof";

/** Git's empty tree (sha1): every path in the baseline copy is added to it. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface RestoreResult {
  restored: string[];
  /** Files edited after the baseline was taken: never overwritten. */
  changedSince: string[];
  /** Files left alone, with why. */
  skipped: Array<{ path: string; why: string }>;
}

/**
 * Put the workspace back to the baseline copy, using the undo store's plan and apply so a file edited
 * since is never overwritten. Secret files are never written back.
 */
export async function restoreFromBaseline(options: {
  workspace: string;
  baseline: ChangeBaseline;
  stateDirectory: string;
  signal?: AbortSignal;
}): Promise<RestoreResult> {
  const store = new UndoStore({ stateDirectory: options.stateDirectory, root: options.workspace });
  const after = await store.snapshot(options.signal);
  if (!("tree" in after)) throw new Error(after.unavailable);

  const entries = new Map<string, { mode: string; data: Buffer } | undefined>();
  const skipped: Array<{ path: string; why: string }> = [];
  for (const relative of (await snapshotTree(options.baseline.beforeTree, options.signal, { git: false })).keys()) {
    if (isSecretFile(relative)) { skipped.push({ path: relative, why: "secret" }); continue; }
    const file = path.join(options.baseline.beforeTree, relative);
    const info = await lstat(file).catch(() => undefined);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      entries.set(relative, { mode: "120000", data: Buffer.from(await readlink(file)) });
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > HASH_LIMIT) { skipped.push({ path: relative, why: "big" }); continue; }
    entries.set(relative, { mode: info.mode & 0o111 ? "100755" : "100644", data: await readFile(file) });
  }

  const beforeTree = await store.overlay(EMPTY_TREE, entries);
  const plan = await store.plan(after.tree, beforeTree);
  const applied = await store.apply(plan.ready, beforeTree, options.signal);
  return {
    restored: applied.restored,
    changedSince: plan.changedSince,
    skipped: [...skipped, ...applied.skipped.map((entry) => ({ path: entry.path, why: entry.why }))],
  };
}
