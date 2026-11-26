import { afterEach, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyPath, privatePlace, realpathLongest, resolveToolPath } from "../src/platform/paths";
import { removeDir, tempDir } from "./support/fixtures";

let workspace: string | undefined;
let home: string | undefined;
let outside: string | undefined;

afterEach(async () => {
  await removeDir(workspace);
  await removeDir(home);
  await removeDir(outside);
  workspace = home = outside = undefined;
});

async function place(): Promise<{ workspace: string; home: string; outside: string }> {
  workspace = await tempDir("paths-work");
  home = await tempDir("paths-home");
  outside = await tempDir("paths-outside");
  await mkdir(path.join(home, ".ssh"), { recursive: true });
  await writeFile(path.join(home, ".ssh", "id_rsa"), "key", "utf8");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(path.join(outside, "note.txt"), "outside\n", "utf8");
  return { workspace, home, outside };
}

test("a key under ~/.ssh is private and named as the user types it", async () => {
  const { workspace, home } = await place();
  const context = { root: workspace, home };
  const key = path.join(home, ".ssh", "id_rsa");
  expect(classifyPath(key, context, false)).toBe("private");
  expect(privatePlace(key, context)).toBe("~/.ssh");
});

test("a file in the workspace is inside", async () => {
  const { workspace, home } = await place();
  expect(classifyPath(path.join(workspace, "src", "a.ts"), { root: workspace, home }, false)).toBe("inside");
});

test("a file outside the workspace is outside", async () => {
  const { workspace, home, outside } = await place();
  expect(classifyPath(path.join(outside, "note.txt"), { root: workspace, home }, false)).toBe("outside");
});

test("shell start-up files are protected from writes, not from reads", async () => {
  const { workspace, home } = await place();
  const bashrc = path.join(home, ".bashrc");
  await writeFile(bashrc, "export A=1\n", "utf8");
  expect(classifyPath(bashrc, { root: workspace, home }, true)).toBe("protected");
  expect(classifyPath(bashrc, { root: workspace, home }, false)).toBe("outside");
});

test("git's own files are gitInternal on a write", async () => {
  const { workspace, home } = await place();
  await mkdir(path.join(workspace, ".git"), { recursive: true });
  const config = path.join(workspace, ".git", "config");
  expect(classifyPath(config, { root: workspace, home }, true)).toBe("gitInternal");
  expect(classifyPath(config, { root: workspace, home }, false)).toBe("inside");
});

test("a link inside the project that leads out is linksOut", async () => {
  const { workspace, home, outside } = await place();
  const link = path.join(workspace, "linked");
  const made = await symlink(outside, link, "junction").then(() => true, () => false);
  if (!made) return; // the platform will not let this user make links
  expect(classifyPath(link, { root: workspace, home }, false)).toBe("linksOut");
});

test("resolveToolPath expands ~ and resolves against the workspace", async () => {
  const { workspace, home } = await place();
  expect(resolveToolPath("~/.ssh", workspace, home)).toBe(path.join(home, ".ssh"));
  expect(resolveToolPath("src/a.ts", workspace, home)).toBe(path.join(workspace, "src", "a.ts"));
});

test("realpathLongest keeps the part of a path that does not exist", async () => {
  const { workspace } = await place();
  const missing = path.join(workspace, "src", "not-there.ts");
  expect(realpathLongest(missing)).toBe(missing);
});
