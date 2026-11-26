import { afterEach, expect, test } from "bun:test";
import { runCommandCheck } from "../src/verify/command";
import { removeDir, tempDir } from "./support/fixtures";

let root: string | undefined;

afterEach(async () => {
  await removeDir(root);
  root = undefined;
});

async function workspace(): Promise<string> {
  root = await tempDir("command");
  return root;
}

const run = (args: string[], extra: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}) =>
  runCommandCheck({
    name: "test",
    argv: [process.execPath, "-e", ...args],
    cwd: root!,
    timeoutMs: extra.timeoutMs ?? 30_000,
    ...(extra.env ? { env: extra.env } : {}),
  });

test("a command that exits 0 passes", async () => {
  await workspace();
  const result = await run(["process.exit(0)"]);
  expect(result.status).toBe("pass");
  expect(result.exitCode).toBe(0);
  expect(result.ended).toBeUndefined();
});

test("a command that exits non-zero fails", async () => {
  await workspace();
  const result = await run(["process.exit(3)"]);
  expect(result.status).toBe("fail");
  expect(result.exitCode).toBe(3);
});

test("a command that runs too long is a timeout, not a failing test", async () => {
  await workspace();
  const result = await run(["setTimeout(() => {}, 5000)"], { timeoutMs: 400 });
  expect(result.status).toBe("fail");
  expect(result.ended).toBe("timeout");
  expect(result.reason).toContain("Timed out");
});

test("a command that cannot start says so", async () => {
  await workspace();
  const result = await runCommandCheck({
    name: "test",
    command: "definitely-not-a-real-program-xyz",
    cwd: root!,
    timeoutMs: 30_000,
  });
  expect(result.status).toBe("fail");
  expect(result.ended).toBe("no_start");
});

test("provider keys are removed from a check's environment", async () => {
  await workspace();
  const result = await run(["console.log(process.env.OPENAI_API_KEY ?? 'absent')"], {
    env: { ...process.env, OPENAI_API_KEY: "sk-test-not-real", CASPER_KEEP: "yes" },
  });
  expect(result.stdout.trim()).toBe("absent");
});

test("output is captured and truncated with a marker", async () => {
  await workspace();
  const result = await run(["console.log('x'.repeat(20000))"]);
  expect(result.truncated).toBe(true);
  expect(result.stdout).toContain("[...output truncated...]");
});
