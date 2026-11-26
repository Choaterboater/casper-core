import path from "node:path";
import { classifyPath, within } from "../platform/paths";
import { splitShell } from "../platform/shell";
import { readOnlyCommand } from "../sandbox/read-only";

export type Outcome = "allow" | "ask" | "deny";
export type Mode = "read-only" | "ask" | "auto";
export type Scope = "once" | "session" | "project";

export type ActionKind = "read" | "write" | "delete" | "shell" | "network" | "git" | "database" | "other";

/** What the host is about to do, in facts the broker can check. The broker does not run anything. */
export interface Action {
  kind: ActionKind;
  /** The command line, path, URL, or short description. */
  target: string;
  /** Absolute path for a file action. */
  path?: string;
  /** The sandbox already refuses this: do not also ask. */
  sandboxDenies?: boolean;
}

export interface Decision {
  outcome: Outcome;
  /** The rule that decided, so an answer can be remembered against it. */
  rule: string;
  /** One line of fact. Never a completion claim. */
  reason: string;
  /** For an ask: what a yes may cover. */
  scope?: Scope;
  /** For an ask: how to stop being asked. */
  offSwitch?: string;
  /** For a deny: the one written line saying why it cannot be scoped. */
  justification?: string;
}

export interface BrokerOptions {
  mode: Mode;
  workspace: string;
  home: string;
}

interface Context {
  workspace: string;
  home: string;
}

/** Routine commands that change things but are part of the loop the user already asked for. */
const ROUTINE = /^(?:bun|npm|pnpm|yarn|npx|bunx)\s+(?:run\s+)?(?:test|tests|lint|typecheck|check|build|format)\b|^(?:pytest|go\s+test|cargo\s+(?:test|check|build)|make|tsc|oxlint|eslint|prettier)\b|^git\s+(?:add|status|diff|log|show|branch|rev-parse)\b|^(?:ls|cat|rg|grep|find|pwd|echo|head|tail|wc|sed\s+-n)\b/;

const FORCE_PUSH = /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease|-if-includes)?|\s-f\b|\s\+\S)/;
const ELEVATED = /^\s*(?:sudo|doas|su|runas)\b/;
const DOWNLOAD_TO_SHELL = /(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|fish|python[\d.]*|node|bun|perl|ruby)\b|(?:sh|bash|zsh)\s+-c\s+["']?\$\((?:curl|wget)\b/;
const DESTRUCTIVE_DB = /\b(?:drop\s+(?:database|table|schema)|truncate\s+table|delete\s+from\s+\S+\s*(?:;|$))/i;
const RISKY_GIT_CONFIG = /\bgit\s+config\b[^\n]*(?:core\.hooksPath|core\.sshCommand|core\.fsmonitor|credential|alias\.|filter\.|include\.)/i;
const SHELL_DELETE = /^\s*(?:rm|rmdir|unlink)\b/;

const why = {
  forcePush: "a force push rewrites history other people may already have",
  elevated: "elevated privileges are outside what this session may grant",
  downloadToShell: "it runs code the user never read",
  deleteOutside: "it deletes outside the project, where there is no undo",
  privatePath: "it holds keys or logins",
  gitInternal: "git's own files, including hooks, run programs later",
  destructiveDb: "it destroys data with no undo",
  riskyGitConfig: "it changes how git runs programs",
};

function outside(absolute: string, context: Context): boolean {
  return !within(context.workspace, absolute);
}

function words(command: string): string[] {
  return splitShell(command).segments.flatMap((segment) => segment.words);
}

function deletesOutside(action: Action, context: Context): boolean {
  if (action.kind === "delete") return action.path ? outside(action.path, context) : false;
  if (action.kind !== "shell" || !SHELL_DELETE.test(action.target)) return false;
  return words(action.target).some((word) => path.isAbsolute(word) && outside(word, context));
}

/** The one table. Every deny carries its justification; every ask carries a scope and an off switch. */
export class ApprovalBroker {
  private readonly remembered = new Set<string>();
  private askCount = 0;
  private readonly options: BrokerOptions;

  constructor(options: BrokerOptions) {
    this.options = options;
  }

  /** How many times this broker asked. The gate-budget fixture reads this. */
  get asks(): number { return this.askCount; }

  decide(action: Action): Decision {
    const context = { workspace: this.options.workspace, home: this.options.home };
    const denied = this.hardDeny(action, context);
    if (denied) return denied;

    if (this.options.mode === "read-only") {
      return this.reads(action, context)
        ? allow("read-only action", "reads only")
        : { outcome: "deny", rule: "read-only-mode", reason: "read-only mode: this task may not change anything" };
    }
    if (this.options.mode === "auto") return allow("auto mode", "auto mode allows everything routine");

    return this.askMode(action, context);
  }

  /** Record the user's answer. A yes for the session or the project covers later actions from the same rule. */
  answer(rule: string, answer: "once" | "session" | "project" | "no"): void {
    if (answer === "session" || answer === "project") this.remembered.add(rule);
  }

  private hardDeny(action: Action, context: Context): Decision | undefined {
    if (action.sandboxDenies) {
      return { outcome: "deny", rule: "sandbox", reason: "the sandbox already refuses this, so there is nothing to ask",
        justification: "the sandbox refuses it for the same reason" };
    }
    if ((action.kind === "git" || action.kind === "shell") && FORCE_PUSH.test(action.target)) {
      return hardDeny("force-push", "it would force push", why.forcePush);
    }
    if (action.kind === "shell" && ELEVATED.test(action.target)) {
      return hardDeny("elevated", "it would use elevated privileges", why.elevated);
    }
    if (action.kind === "shell" && DOWNLOAD_TO_SHELL.test(action.target)) {
      return hardDeny("download-to-shell", "it would run downloaded code", why.downloadToShell);
    }
    if (deletesOutside(action, context)) {
      return hardDeny("delete-outside", "it would delete outside the project", why.deleteOutside);
    }
    if (action.kind === "database" || (action.kind === "shell" && DESTRUCTIVE_DB.test(action.target))) {
      return hardDeny("destructive-database", "it would destroy database data", why.destructiveDb);
    }
    if (action.kind === "shell" && RISKY_GIT_CONFIG.test(action.target)) {
      return hardDeny("risky-git-config", "it would change how git runs programs", why.riskyGitConfig);
    }
    if (action.path && (action.kind === "write" || action.kind === "delete")) {
      const kind = classifyPath(action.path, { root: context.workspace, home: context.home }, true);
      if (kind === "private") return hardDeny("private-path", "it would write to a private path", why.privatePath);
      if (kind === "gitInternal") return hardDeny("git-internal", "it would write to git's own files", why.gitInternal);
    }
    return undefined;
  }

  private reads(action: Action, context: Context): boolean {
    if (action.kind === "read") return true;
    if (action.kind !== "shell") return false;
    return readOnlyCommand(action.target, { root: context.workspace, home: context.home });
  }

  private askMode(action: Action, context: Context): Decision {
    if (this.reads(action, context)) return allow("read", "reads only");

    if (action.path && (action.kind === "write" || action.kind === "delete")) {
      const kind = classifyPath(action.path, { root: context.workspace, home: context.home }, true);
      if (kind === "inside") return allow("in-project", "inside the project");
      return this.ask("outside-write", "it would change a file outside the project", "session",
        "No changes nothing. Yes, for this session covers the rest of the session.");
    }

    if (action.kind === "shell" && ROUTINE.test(action.target.trim())) {
      return allow("routine", "part of the fix-test-check loop");
    }
    const gitVerb = /^\s*git\s+(commit|push)\b/.exec(action.target)?.[1];
    if (action.kind === "git" || gitVerb) {
      return this.ask(`git-${gitVerb ?? "other"}`, "it would change the repository", "session",
        "No runs nothing. Yes, for this session covers later git commands.");
    }
    if (action.kind === "network") {
      return this.ask("network", "it would reach the network", "session",
        "No leaves the network alone. Yes, for this session covers the rest of the session.");
    }
    return this.ask(`${action.kind}-other`, "it would run a command outside the routine loop", "session",
      "No runs nothing. Yes, for this session covers the rest of the session. Auto mode stops asking.");
  }

  private ask(rule: string, reason: string, scope: Scope, offSwitch: string): Decision {
    if (this.remembered.has(rule)) {
      return allow(rule, "you said yes for this session");
    }
    this.askCount++;
    return { outcome: "ask", rule, reason, scope, offSwitch };
  }
}

function allow(rule: string, reason: string): Decision {
  return { outcome: "allow", rule, reason };
}

function hardDeny(rule: string, reason: string, justification: string): Decision {
  return { outcome: "deny", rule, reason, justification };
}

/** The gate-budget fixture and the parity test both need this ordering. */
export function strictness(outcome: Outcome): number {
  return outcome === "allow" ? 0 : outcome === "ask" ? 1 : 2;
}
