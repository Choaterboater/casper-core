import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A throwaway folder per test, removed by the caller. */
export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `casper-core-${prefix}-`));
}

/** Write `files` (relative path -> text) under `root`, making folders as needed. */
export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

export async function removeDir(dir: string | undefined): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** A small project whose test fails until `src/sum.js` is fixed. */
export const BUGGY_SUM = "export function sum(a, b) { return a - b; }\n";
export const FIXED_SUM = "export function sum(a, b) { return a + b; }\n";
export const SUM_TEST = [
  'import { expect, test } from "bun:test";',
  'import { sum } from "../src/sum.js";',
  "",
  'test("sum adds", () => {',
  "  expect(sum(2, 3)).toBe(5);",
  "});",
  "",
].join("\n");
