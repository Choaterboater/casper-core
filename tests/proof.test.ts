import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { ChangeBaseline } from "../src/verify/proof";
import { diffSnapshots, snapshotTree } from "../src/task/changes";
import { BUGGY_SUM, FIXED_SUM, SUM_TEST, removeDir, tempDir, writeFiles } from "./support/fixtures";

let root: string | undefined;
let baseline: ChangeBaseline | undefined;

afterEach(async () => {
  await baseline?.dispose();
  baseline = undefined;
  await removeDir(root);
  root = undefined;
});

async function project(sum = BUGGY_SUM): Promise<string> {
  root = await tempDir("proof");
  await writeFiles(root, {
    "src/sum.js": sum,
    "tests/sum.test.js": SUM_TEST,
  });
  return root;
}

const CHECK = { check: "test" as const, command: "bun test", timeoutMs: 120_000 };

test("a fix that makes the failing test pass is proven", async () => {
  const workspace = await project();
  const before = await snapshotTree(workspace);
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test" });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });
  const changes = diffSnapshots(before, await snapshotTree(workspace));

  const proof = await baseline.prove({ root: workspace, changes, ...CHECK });

  expect(proof?.status).toBe("proven");
  if (proof?.status !== "proven") throw new Error("expected proven");
  expect(proof.without.ended).toBe("fail");
  expect(proof.without.exitCode).not.toBe(0);
  expect(proof.testsChanged).toBe(false);
});

test("a code change the tests do not notice is unproven", async () => {
  const workspace = await project(FIXED_SUM);
  const before = await snapshotTree(workspace);
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test" });
  // A change in code the test does not reach: the suite passes with it and without it.
  await writeFiles(workspace, { "src/unused.js": "export const unused = 1;\n" });
  const changes = diffSnapshots(before, await snapshotTree(workspace));

  const proof = await baseline.prove({ root: workspace, changes, ...CHECK });

  expect(proof?.status).toBe("unproven");
  if (proof?.status !== "unproven") throw new Error("expected unproven");
  expect(proof.without.ended).toBe("pass");
  expect(proof.without.exitCode).toBe(0);
});

test("a test-only change needs no proof", async () => {
  const workspace = await project();
  const before = await snapshotTree(workspace);
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test" });
  await writeFiles(workspace, { "tests/sum.test.js": `${SUM_TEST}\ntest("extra", () => {});\n` });
  const changes = diffSnapshots(before, await snapshotTree(workspace));

  const proof = await baseline.prove({ root: workspace, changes, ...CHECK });

  expect(proof).toBeUndefined();
});

test("before() runs the check on the code as it was", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test" });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });

  expect(await baseline.before({ root: workspace, ...CHECK })).toBe("fail");
});

test("a check that also fails with the change is unavailable, not proven", async () => {
  const workspace = await project();
  const before = await snapshotTree(workspace);
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test" });
  // Still broken, so "without" fails and "with" fails too: nothing is proven.
  await writeFiles(workspace, { "src/sum.js": "export function sum(a, b) { return a * b; }\n" });
  const changes = diffSnapshots(before, await snapshotTree(workspace));

  const proof = await baseline.prove({ root: workspace, changes, ...CHECK });

  expect(proof?.status).toBe("unavailable");
});

test("the baseline copy leaves the workspace untouched", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test" });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });

  await baseline.prove({
    root: workspace,
    changes: { added: [], modified: [path.join("src", "sum.js").split(path.sep).join("/")], removed: [] },
    ...CHECK,
  });

  expect(await Bun.file(path.join(workspace, "src", "sum.js")).text()).toBe(FIXED_SUM);
});
