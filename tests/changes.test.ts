import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
import path from "node:path";
import { diffSnapshots, snapshotTree } from "../src/task/changes";
import { removeDir, tempDir, writeFiles } from "./support/fixtures";

let root: string | undefined;

afterEach(async () => {
  await removeDir(root);
  root = undefined;
});

test("diffSnapshots sorts added, modified and removed", async () => {
  root = await tempDir("changes");
  await writeFiles(root, { "a.js": "a\n", "b.js": "b\n" });
  const before = await snapshotTree(root);
  await writeFiles(root, { "a.js": "a2\n", "c.js": "c\n" });
  await rm(path.join(root, "b.js"));
  const changes = diffSnapshots(before, await snapshotTree(root));
  expect(changes).toEqual({ added: ["c.js"], modified: ["a.js"], removed: ["b.js"] });
});

test("dependency trees, git and caches are not snapshotted", async () => {
  root = await tempDir("changes-skip");
  await writeFiles(root, {
    "src/a.js": "a\n",
    "node_modules/pkg/index.js": "x\n",
    ".git/config": "x\n",
    ".venv/lib/x.py": "x\n",
    "__pycache__/x.pyc": "x\n",
  });
  const snapshot = await snapshotTree(root);
  expect([...snapshot.keys()].sort()).toEqual(["src/a.js"]);
});

test("a folder git can list is snapshotted from git, so ignored files are left out", async () => {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { return; } // no git here: nothing to list
  root = await tempDir("changes-git");
  await writeFiles(root, { "kept.txt": "k\n", "ignored.txt": "i\n", ".gitignore": "ignored.txt\n" });
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  const snapshot = await snapshotTree(root);
  expect(snapshot.has("kept.txt")).toBe(true);
  expect(snapshot.has(".gitignore")).toBe(true);
  expect(snapshot.has("ignored.txt")).toBe(false);
  expect([...snapshot.keys()].some((name) => name.startsWith(".git/"))).toBe(false);
});

test("without git the folder is walked and ignored files are seen", async () => {
  root = await tempDir("changes-walk");
  await writeFiles(root, { "kept.txt": "k\n", "ignored.txt": "i\n", ".gitignore": "ignored.txt\n" });
  // A temp folder can sit inside a repository (a home folder that is one), so ask for the walk explicitly.
  const snapshot = await snapshotTree(root, undefined, { git: false });
  expect(snapshot.has("ignored.txt")).toBe(true);
});

test("an executable bit is part of a file's identity where the platform has one", async () => {
  root = await tempDir("changes-mode");
  if (process.platform === "win32") return; // Windows has no such bit
  await writeFiles(root, { "run.sh": "#!/bin/sh\necho ok\n" });
  const before = await snapshotTree(root);
  await chmod(path.join(root, "run.sh"), 0o755);
  const after = await snapshotTree(root);
  expect(after.get("run.sh")).not.toBe(before.get("run.sh"));
});
