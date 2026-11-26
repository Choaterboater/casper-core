import type { CommandSandbox } from "./sandbox/types";

export interface Clock {
  now(): Date;
}

/** Where a host wants progress or facts written. Unset: the caller collects the return value and prints it. */
export interface Output {
  line(text: string): void;
}

export type ApprovalOutcome = "allow" | "ask" | "deny";

export interface ApprovalRequest {
  /** What would happen, in the user's words: "run bun test", "write /etc/hosts". */
  action: string;
  /** Why it is not routine, when it is not. */
  reason?: string;
}

/** One broker, one table, three outcomes. The kernel never grows a second gate. */
export interface ApprovalBroker {
  decide(request: ApprovalRequest): ApprovalOutcome | Promise<ApprovalOutcome>;
}

/**
 * Everything the kernel is allowed to know about its caller. It never sees an app object, a UI, a
 * session, or a model loop. Add a field only when a kernel function needs it and the field has a
 * meaning outside this repository.
 */
export interface TaskContext {
  /** The project folder. */
  workspace: string;
  /** The user's home folder. Private-path checks resolve against it. */
  home: string;
  /** Where baseline copies are made. Unset: the OS temp folder. */
  scratch?: string;
  /** The shell sandbox for check runs. Unset or `false`: checks run unheld. */
  sandbox?: CommandSandbox | false;
  /** Environment for check runs. Provider keys are always removed. Unset: `process.env`. */
  env?: NodeJS.ProcessEnv;
  output?: Output;
  clock?: Clock;
  approvals?: ApprovalBroker;
}

export const systemClock: Clock = { now: () => new Date() };

export function contextClock(context: TaskContext): Clock {
  return context.clock ?? systemClock;
}
