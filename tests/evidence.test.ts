import { expect, test } from "bun:test";
import { EXIT, evidenceExitCode, type Evidence } from "../src/evidence";

const base: Evidence = {
  checks: [{ name: "test", status: "pass" }],
  proof: { status: "proven" },
  files: { added: [], modified: [], removed: [] },
  requirements: [],
  ranAt: "2026-01-01T00:00:00.000Z",
};

test("complete evidence exits 0", () => {
  expect(evidenceExitCode(base)).toBe(EXIT.complete);
});

test("a failed check exits 1, whatever the proof says", () => {
  expect(evidenceExitCode({ ...base, checks: [{ name: "test", status: "fail" }] })).toBe(EXIT.checksFailed);
  expect(evidenceExitCode({ ...base, checks: [{ name: "test", status: "fail" }], proof: { status: "unavailable" } })).toBe(EXIT.checksFailed);
});

test("passing checks without proof exit 2", () => {
  expect(evidenceExitCode({ ...base, proof: { status: "unproven" } })).toBe(EXIT.unproven);
  expect(evidenceExitCode({ ...base, proof: undefined })).toBe(EXIT.unproven);
});

test("a check that did not run exits 3", () => {
  expect(evidenceExitCode({ ...base, checks: [{ name: "test", status: "blocked" }] })).toBe(EXIT.couldNotRun);
  expect(evidenceExitCode({ ...base, checks: [{ name: "test", status: "skipped" }] })).toBe(EXIT.couldNotRun);
  expect(evidenceExitCode({ ...base, checks: [] })).toBe(EXIT.couldNotRun);
});

test("a proof that could not be built exits 3", () => {
  expect(evidenceExitCode({ ...base, proof: { status: "unavailable" } })).toBe(EXIT.couldNotRun);
});

test("an absent proof fails closed", () => {
  // Omitting the proof is how a caller would hide an unproven change, so it counts as missing.
  expect(evidenceExitCode({ ...base, proof: undefined })).toBe(EXIT.unproven);
});
