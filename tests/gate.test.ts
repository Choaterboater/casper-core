import { afterEach, expect, test } from "bun:test";
import os from "node:os";
import { evidenceExitCode, EXIT } from "../src/evidence";
import { formatEvidence, formatRefusal } from "../src/format";
import { verifyChange } from "../src/verify/gate";
import { ChangeBaseline } from "../src/verify/proof";
import { BUGGY_SUM, FIXED_SUM, SUM_TEST, removeDir, tempDir, writeFiles } from "./support/fixtures";

const home = os.homedir();
let root: string | undefined;
let baseline: ChangeBaseline | undefined;

afterEach(async () => {
  await baseline?.dispose();
  baseline = undefined;
  await removeDir(root);
  root = undefined;
});

async function project(sum = BUGGY_SUM): Promise<string> {
  root = await tempDir("gate");
  await writeFiles(root, { "src/sum.js": sum, "tests/sum.test.js": SUM_TEST });
  return root;
}

const context = (workspace: string) => ({ workspace, home, sandbox: false as const });
const check = [{ name: "test" as const, command: "bun test" }];

test("a proven fix returns evidence and exits 0", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });

  const evidence = await verifyChange({ context: context(workspace), checks: check, requireProof: true, baseline });

  expect(evidence.checks).toEqual([{ name: "test", status: "pass" }]);
  expect(evidence.proof?.status).toBe("proven");
  expect(evidence.files.modified).toEqual(["src/sum.js"]);
  expect(evidenceExitCode(evidence)).toBe(EXIT.complete);
});

test("passing checks without a proof exit 2", async () => {
  const workspace = await project(FIXED_SUM);
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  await writeFiles(workspace, { "src/unused.js": "export const unused = 1;\n" });

  const evidence = await verifyChange({ context: context(workspace), checks: check, requireProof: true, baseline });

  expect(evidence.proof?.status).toBe("unproven");
  expect(evidenceExitCode(evidence)).toBe(EXIT.unproven);
  const refusal = formatRefusal(evidence, EXIT.unproven);
  expect(refusal).toContain("refused: the change is not proven");
  expect(refusal).toContain("proof: the check passes without the change");
});

test("a failing check exits 1 and outranks the proof", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  // A change that still fails the test: the comparison is never reached.
  await writeFiles(workspace, { "src/sum.js": "export function sum(a, b) { return a * b; }\n" });

  const evidence = await verifyChange({ context: context(workspace), checks: check, requireProof: true, baseline });

  expect(evidence.checks[0]).toMatchObject({ name: "test", status: "fail" });
  expect(evidence.proof?.status).toBe("unavailable");
  expect(evidenceExitCode(evidence)).toBe(EXIT.checksFailed);
});

test("proof without a baseline is unavailable and exits 3", async () => {
  const workspace = await project(FIXED_SUM);

  const evidence = await verifyChange({ context: context(workspace), checks: check, requireProof: true });

  expect(evidence.proof).toMatchObject({ status: "unavailable" });
  expect(evidence.proof?.reason).toContain("baseline");
  expect(evidenceExitCode(evidence)).toBe(EXIT.couldNotRun);
});

test("without requireProof the gate reports no proof and the caller decides", async () => {
  const workspace = await project(FIXED_SUM);

  const evidence = await verifyChange({ context: context(workspace), checks: check });

  expect(evidence.proof).toBeUndefined();
  expect(evidenceExitCode(evidence, { proofRequired: false })).toBe(EXIT.complete);
  expect(evidenceExitCode(evidence)).toBe(EXIT.unproven);
});

test("requirements are echoed, never inferred", async () => {
  const workspace = await project(FIXED_SUM);
  const evidence = await verifyChange({
    context: context(workspace),
    checks: check,
    requirements: [{ text: "sum adds", status: "open" }],
  });
  expect(evidence.requirements).toEqual([{ text: "sum adds", status: "open" }]);
  expect(formatEvidence(evidence)).toContain("open requirements: sum adds");
});

test("the printed evidence carries no verdict words", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });
  const evidence = await verifyChange({ context: context(workspace), checks: check, requireProof: true, baseline });

  const text = formatEvidence(evidence);
  expect(text).not.toMatch(/Verified|Done|✓|✔|✗/);
  expect(text).not.toMatch(/\b(all good|success|succeeded)\b/i);
  expect(text).toContain("checks: test pass (1/1)");
  expect(text).toContain("proof: the check fails without the change and passes with it");
  expect(text).toContain("files: src/sum.js");
});
