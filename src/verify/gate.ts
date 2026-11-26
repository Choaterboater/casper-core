import { changesCode } from "../code";
import { contextClock, type TaskContext } from "../context";
import type { CheckName, CheckResult, CommandResult, Evidence, ProofResult, Requirement } from "../evidence";
import { diffSnapshots, snapshotTree } from "../task/changes";
import { runCommandCheck } from "./command";
import type { ChangeBaseline } from "./proof";

export const DEFAULT_CHECK_TIMEOUT_MS = 600_000;

export interface CheckSpec {
  name: CheckName;
  /** The command line the project itself uses. */
  command: string;
  timeoutMs?: number;
}

export interface VerifyChangeInput {
  context: TaskContext;
  /** At least one. They run in order, in the workspace. */
  checks: readonly CheckSpec[];
  /** Prove the change: the proving check must fail without it. Requires a baseline. */
  requireProof?: boolean;
  /** The copy taken before the change. Without one, `files` is empty and proof is unavailable. */
  baseline?: ChangeBaseline;
  /** Declared by the caller and echoed back. Never inferred. */
  requirements?: readonly Requirement[];
  signal?: AbortSignal;
}

/**
 * Run the project's checks and, when asked, compare the change with the code as it was. Returns facts.
 * It never decides that the work is finished; the caller reads the evidence or the refusal.
 */
export async function verifyChange(input: VerifyChangeInput): Promise<Evidence> {
  const { context } = input;
  const ranAt = contextClock(context).now().toISOString();

  const results: CommandResult[] = [];
  for (const spec of input.checks) {
    results.push(await runCommandCheck({
      name: spec.name,
      command: spec.command,
      cwd: context.workspace,
      timeoutMs: spec.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
      ...(context.sandbox ? { sandbox: context.sandbox } : {}),
      ...(context.env ? { env: context.env } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    }));
  }
  const checks = results.map(toCheckResult);

  const files = input.baseline
    ? diffSnapshots(
      withoutCasper(await snapshotTree(input.baseline.beforeTree, input.signal, { git: false })),
      withoutCasper(await snapshotTree(context.workspace, input.signal, { git: false })),
    )
    : { added: [], modified: [], removed: [] };

  const proof = input.requireProof
    ? await prove(input, results, files, checks)
    : undefined;

  return { checks, ...(proof ? { proof } : {}), files, requirements: [...(input.requirements ?? [])], ranAt };
}

/** Run the checks only, with no comparison. The caller reads the facts and decides. */
export function runChecks(input: {
  context: TaskContext;
  checks: readonly CheckSpec[];
  signal?: AbortSignal;
}): Promise<Evidence> {
  return verifyChange({
    context: input.context,
    checks: input.checks,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

/** A baseline that exists but shows no code change needs no comparison: there is nothing to prove. */
function provenAlready(reason: string): ProofResult {
  return { status: "proven", reason };
}

async function prove(
  input: VerifyChangeInput,
  results: readonly CommandResult[],
  files: Evidence["files"],
  checks: readonly CheckResult[],
): Promise<ProofResult> {
  if (!input.baseline) {
    return { status: "unavailable", reason: "no baseline was captured before the change" };
  }
  if (!changesCode(files)) return provenAlready("no code change to prove");

  // The test check proves the change; any other passing check is a weaker substitute, so prefer test.
  const at = Math.max(0, input.checks.findIndex((spec) => spec.name === "test"));
  const spec = input.checks[at];
  if (!spec) return { status: "unavailable", reason: "no check was given to prove with" };
  if (checks[at]?.status !== "pass") {
    return { status: "unavailable", reason: `${spec.name} did not pass, so the comparison was not run` };
  }

  const outcome = await input.baseline.prove({
    root: input.context.workspace,
    changes: files,
    check: spec.name,
    command: spec.command,
    timeoutMs: spec.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!outcome) return provenAlready("no code change to prove");
  if (outcome.status === "proven") return { status: "proven", reason: "the check fails without the change and passes with it" };
  if (outcome.status === "unproven") {
    return {
      status: "unproven",
      reason: outcome.testsChanged
        ? "the changed tests also pass without the change"
        : "the check passes without the change",
    };
  }
  return { status: "unavailable", reason: outcome.reason };
}

function toCheckResult(result: CommandResult): CheckResult {
  if (result.status === "pass") return { name: result.name, status: "pass" };
  if (result.ended === "blocked") return { name: result.name, status: "blocked", detail: result.reason ?? "blocked by the sandbox" };
  // A timeout, a command that could not start, or unconfirmed cleanup is not the code failing: it did not run.
  if (result.ended) return { name: result.name, status: "skipped", detail: result.reason ?? result.ended };
  const detail = result.exitCode === null ? result.signal ?? "no exit status" : `exit ${result.exitCode}`;
  return { name: result.name, status: "fail", detail };
}

/** Casper's own state folder is not part of the change, and the baseline copy never holds it. */
function withoutCasper(snapshot: Map<string, string>): Map<string, string> {
  return new Map([...snapshot].filter(([relative]) => relative !== ".casper" && !relative.startsWith(".casper/")));
}
