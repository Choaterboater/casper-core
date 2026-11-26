import { afterEach, expect, test } from "bun:test";
import { readOnlyCommand, type ReadPlace } from "../src/sandbox/read-only";
import { removeDir, tempDir, writeFiles } from "./support/fixtures";

let workspace: string | undefined;
let home: string | undefined;

afterEach(async () => {
  await removeDir(workspace);
  await removeDir(home);
  workspace = home = undefined;
});

async function place(): Promise<ReadPlace> {
  workspace = await tempDir("readonly-work");
  home = await tempDir("readonly-home");
  await writeFiles(workspace, { "README.md": "hello\n", "src/a.ts": "export const a = 1;\n" });
  return { root: workspace, home };
}

test("listing, reading and searching are read-only", async () => {
  const where = await place();
  for (const command of ["ls", "ls -la", "cat README.md", "grep -r hello src", "git status", "git log --oneline -5", "git diff"]) {
    expect(readOnlyCommand(command, where)).toBe(true);
  }
});

test("removing, writing and pushing are not read-only", async () => {
  const where = await place();
  for (const command of ["rm -rf src", "mv src other", "git push", "git commit -m x", "npm install", "chmod +x run.sh"]) {
    expect(readOnlyCommand(command, where)).toBe(false);
  }
});

test("redirection makes a reading command a write", async () => {
  const where = await place();
  expect(readOnlyCommand("echo hi > out.txt", where)).toBe(false);
  expect(readOnlyCommand("cat README.md >> log.txt", where)).toBe(false);
  expect(readOnlyCommand("cat README.md | grep hello", where)).toBe(true);
});

test("a secret file is not read even by a read-only command", async () => {
  const where = await place();
  expect(readOnlyCommand("cat .env", where)).toBe(false);
  expect(readOnlyCommand("cat ~/.ssh/id_rsa", where)).toBe(false);
});
