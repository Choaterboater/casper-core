import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { EXIT } from "../src/evidence";
import { BUGGY_SUM, FIXED_SUM, SUM_TEST, removeDir, tempDir, writeFiles } from "./support/fixtures";

const CLI = path.join(import.meta.dir, "..", "src", "cli.ts");
let root: string | undefined;

afterEach(async () => {
  await removeDir(root);
  root = undefined;
});

async function project(sum = BUGGY_SUM): Promise<string> {
  root = await tempDir("cli");
  await writeFiles(root, { "src/sum.js": sum, "tests/sum.test.js": SUM_TEST });
  return root;
}

async function cli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

async function baselineHandle(workspace: string): Promise<string> {
  const result = await cli(["baseline", "--path", workspace, "--command", "bun test"]);
  expect(result.code).toBe(EXIT.complete);
  const handle = /^baseline: (.+)$/m.exec(result.stdout)?.[1]?.trim();
  if (!handle) throw new Error(`no handle in: ${result.stdout}${result.stderr}`);
  return handle;
}

test("baseline then verify proves a fix and exits 0", async () => {
  const workspace = await project();
  const handle = await baselineHandle(workspace);
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });

  const result = await cli(["verify", "--path", workspace, "--command", "bun test", "--require-proof", "--baseline", handle, "--discard"]);

  expect(result.stderr).toBe("");
  expect(result.code).toBe(EXIT.complete);
  expect(result.stdout).toContain("checks: test pass (1/1)");
  expect(result.stdout).toContain("proof: the check fails without the change and passes with it");
  expect(result.stdout).not.toMatch(/Verified|Done|✓|✔/);
});

test("a change the tests do not notice is refused with exit 2", async () => {
  const workspace = await project(FIXED_SUM);
  const handle = await baselineHandle(workspace);
  await writeFiles(workspace, { "src/unused.js": "export const unused = 1;\n" });

  const result = await cli(["verify", "--path", workspace, "--command", "bun test", "--require-proof", "--baseline", handle, "--discard"]);

  expect(result.code).toBe(EXIT.unproven);
  expect(result.stdout).toContain("refused: the change is not proven");
  expect(result.stdout).toContain("proof: the check passes without the change");
});

test("proof without a baseline is refused with exit 3", async () => {
  const workspace = await project(FIXED_SUM);

  const result = await cli(["verify", "--path", workspace, "--command", "bun test", "--require-proof"]);

  expect(result.code).toBe(EXIT.couldNotRun);
  expect(result.stdout).toContain("refused: the checks could not run");
  expect(result.stdout).toContain("no baseline was captured before the change");
});

test("a failing check exits 1", async () => {
  const workspace = await project();

  const result = await cli(["verify", "--path", workspace, "--command", "bun test"]);

  expect(result.code).toBe(EXIT.checksFailed);
  expect(result.stdout).toContain("refused: a check failed");
});

test("--json prints the facts and the exit code", async () => {
  const workspace = await project(FIXED_SUM);
  const result = await cli(["verify", "--path", workspace, "--command", "bun test", "--json"]);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.checks).toEqual([{ name: "test", status: "pass" }]);
  expect(parsed.exitCode).toBe(EXIT.complete);
});
