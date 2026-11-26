export { VERSION } from "./version";

export { EXIT, evidenceExitCode } from "./evidence";
export type {
  CheckName,
  CheckResult,
  CheckStatus,
  CommandResult,
  Evidence,
  ExitCode,
  FileChanges,
  ProofResult,
  ProofStatus,
  Requirement,
} from "./evidence";

export { contextClock, systemClock } from "./context";
export type {
  ApprovalBroker,
  ApprovalOutcome,
  ApprovalRequest,
  Clock,
  Output,
  TaskContext,
} from "./context";

export { changesCode, isCodePath, isTestPath } from "./code";
export type { ChangedPaths } from "./code";

export { formatEvidence, formatRefusal } from "./format";

export { verifyChange } from "./verify/gate";
export type { CheckSpec, VerifyChangeInput } from "./verify/gate";
export { ChangeBaseline } from "./verify/proof";
