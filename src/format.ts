import { EXIT, type CheckResult, type Evidence, type ExitCode, type FileChanges, type ProofResult, type Requirement } from "./evidence";

/**
 * Facts only. No verdict words, no checkmark, no folded summary. Every line says what happened, and a
 * reader decides for themselves whether that is enough.
 */
export function formatEvidence(evidence: Evidence): string {
  const lines = [`checks: ${checkSummary(evidence.checks)}`];
  if (evidence.proof) lines.push(`proof: ${proofText(evidence.proof)}`);
  lines.push(`files: ${filesText(evidence.files)}`);
  lines.push(`open requirements: ${requirementsText(evidence.requirements)}`);
  return lines.join("\n");
}

function checkSummary(checks: readonly CheckResult[]): string {
  if (!checks.length) return "none ran";
  const passed = checks.filter((check) => check.status === "pass").length;
  const parts = checks.map((check) => {
    const detail = check.detail ? `: ${check.detail}` : "";
    return `${check.name} ${check.status}${detail}`;
  });
  return `${parts.join(", ")} (${passed}/${checks.length})`;
}

function proofText(proof: ProofResult): string {
  if (proof.status === "proven") return proof.reason ?? "the check fails without the change and passes with it";
  if (proof.status === "unproven") return proof.reason ?? "the check passes without the change";
  return `unavailable: ${proof.reason ?? "the comparison was not run"}`;
}

function filesText(files: FileChanges): string {
  const parts = [
    ...files.added.map((file) => `+${file}`),
    ...files.modified,
    ...files.removed.map((file) => `-${file}`),
  ];
  return parts.length ? parts.join(", ") : "none";
}

function requirementsText(requirements: readonly Requirement[]): string {
  if (!requirements.length) return "none declared";
  const open = requirements.filter((requirement) => requirement.status === "open");
  if (!open.length) return `none (${requirements.length} closed)`;
  return open.map((requirement) => requirement.text).join("; ");
}

/** The gate's refusal: the reason in one line, then the facts that produced it. */
export function formatRefusal(evidence: Evidence, code: ExitCode): string {
  const why = code === EXIT.checksFailed ? "a check failed" : code === EXIT.unproven ? "the change is not proven" : "the checks could not run";
  return `refused: ${why}\n${formatEvidence(evidence)}`;
}
