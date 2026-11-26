import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { sandboxPolicy } from "../src/sandbox/policy";
import { within } from "../src/platform/paths";
import { removeDir, tempDir } from "./support/fixtures";

let workspace: string | undefined;
let home: string | undefined;
let temp: string | undefined;

afterEach(async () => {
  await removeDir(workspace);
  await removeDir(home);
  await removeDir(temp);
  workspace = home = temp = undefined;
});

async function place(): Promise<{ workspace: string; home: string; temp: string }> {
  workspace = await tempDir("policy-work");
  home = await tempDir("policy-home");
  temp = await tempDir("policy-temp");
  return { workspace, home, temp };
}

const has = (paths: readonly string[], target: string) => paths.some((entry) => within(entry, target));

test("the project and the temp folder are writable", async () => {
  const { workspace, home, temp } = await place();
  const policy = sandboxPolicy({ root: workspace, home, tempDirs: [temp] });
  expect(has(policy.allowWrite, workspace)).toBe(true);
  expect(has(policy.allowWrite, temp)).toBe(true);
});

test("keys, logins and git's own files are denied", async () => {
  const { workspace, home, temp } = await place();
  const policy = sandboxPolicy({ root: workspace, home, tempDirs: [temp] });
  expect(has(policy.denyWrite, path.join(home, ".ssh"))).toBe(true);
  expect(has(policy.denyRead, path.join(home, ".ssh"))).toBe(true);
  expect(has(policy.denyWrite, path.join(home, ".aws"))).toBe(true);
  expect(has(policy.denyWrite, path.join(workspace, ".git", "config"))).toBe(true);
});

test("a read-only project is not writable", async () => {
  const { workspace, home, temp } = await place();
  const policy = sandboxPolicy({ root: workspace, home, tempDirs: [temp], readOnlyProject: true });
  expect(has(policy.allowWrite, workspace)).toBe(false);
  expect(has(policy.allowWrite, temp)).toBe(true);
});

test("a project denyRead is private to the sandbox too", async () => {
  const { workspace, home, temp } = await place();
  const privateFolder = path.join(workspace, "private-data");
  const policy = sandboxPolicy({ root: workspace, home, tempDirs: [temp], project: { denyRead: ["private-data"] } });
  expect(has(policy.denyRead, privateFolder)).toBe(true);
});

test("a session write is allowed but keeps git's own files denied", async () => {
  const { workspace, home, temp } = await place();
  const other = await tempDir("policy-other");
  try {
    const policy = sandboxPolicy({ root: workspace, home, tempDirs: [temp], sessionWrites: [other] });
    expect(has(policy.allowWrite, other)).toBe(true);
    expect(has(policy.denyWrite, path.join(other, ".git", "hooks"))).toBe(true);
  } finally {
    await removeDir(other);
  }
});
