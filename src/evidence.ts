/** A check's name: one of the four built-ins, or a name the project gave under `verify.checks`. */
export type CheckName = "typecheck" | "lint" | "test" | "build" | (string & {});

/** What happened when the check ran. `blocked` means the sandbox or the environment said no; `skipped` means
 * it was not run at all. Neither is a pass. */
export type CheckStatus = "pass" | "fail" | "blocked" | "skipped";

export interface CheckResult {
  name: CheckName;
  status: CheckStatus;
  /** One line of fact: the exit code, the timeout, the sandbox's refusal. Never a verdict. */
  detail?: string;
}

export type ProofStatus = "proven" | "unproven" | "unavailable";

export interface ProofResult {
  status: ProofStatus;
  /** Why it is unproven or unavailable. Facts, not advice. */
  reason?: string;
}

export interface FileChanges {
  added: string[];
  modified: string[];
  removed: string[];
}

/** Declared by the caller. casper-core never infers a requirement. */
export interface Requirement {
  text: string;
  status: "open" | "done";
}

/** Facts only. There is no verdict field, and no formatter may add one. */
export interface Evidence {
  checks: CheckResult[];
  proof?: ProofResult;
  files: FileChanges;
  requirements: Requirement[];
  /** ISO 8601, from the context's clock. */
  ranAt: string;
}

/** One command run, before it is reduced to a CheckResult. */
export interface CommandResult {
  name: CheckName;
  command: string;
  cwd: string;
  /** "outside the sandbox" when the run was not held. */
  label?: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  status: "pass" | "fail";
  exitCode: number | null;
  signal: string | null;
  reason?: string;
  /** Set when the command did not finish as a check run: it timed out, could not start, was blocked by the
   * sandbox, or left processes running. Such a failure is not the code failing. */
  ended?: "timeout" | "no_start" | "blocked" | "cleanup";
  repair?: "repairable" | "ask" | "never";
}

export const EXIT = {
  complete: 0,
  checksFailed: 1,
  unproven: 2,
  couldNotRun: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The exit code for a set of facts. Order matters: a failed check outranks an unavailable proof,
 * and anything that did not run outranks a missing proof. When `proofRequired` is unset it is true, so
 * an absent proof fails closed. */
export function evidenceExitCode(evidence: Evidence, options: { proofRequired?: boolean } = {}): ExitCode {
  if (evidence.checks.some((check) => check.status === "fail")) return EXIT.checksFailed;
  if (evidence.checks.some((check) => check.status === "blocked" || check.status === "skipped")) return EXIT.couldNotRun;
  if (!evidence.checks.length) return EXIT.couldNotRun;
  if (options.proofRequired === false) return EXIT.complete;
  if (!evidence.proof) return EXIT.unproven;
  if (evidence.proof.status === "unavailable") return EXIT.couldNotRun;
  if (evidence.proof.status !== "proven") return EXIT.unproven;
  return EXIT.complete;
}
