#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import os from "node:os";
import path from "node:path";
import { changesCode } from "../code";
import { evidenceExitCode, EXIT, type Evidence, type Requirement } from "../evidence";
import { formatEvidence, formatRefusal } from "../format";
import { VERSION } from "../version";
import { runChecks, verifyChange, type CheckSpec } from "../verify/gate";
import { ChangeBaseline } from "../verify/proof";
import { restoreFromBaseline } from "../verify/restore";

/** The last baseline each workspace used, so undo_last has something to restore to. */
const lastBaseline = new Map<string, ChangeBaseline>();

const STATE_DIR = path.join(os.tmpdir(), "casper-core-undo");

const TOOLS = [
  {
    name: "verify_change",
    description: "Run the project's checks and prove the change matters: the check must fail without it. Returns facts only. When isError is true or exitCode is not 0, do not claim the change is done.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The project's test command, exactly as the project runs it." },
        name: { type: "string", description: "Check name. Default: test." },
        require_proof: { type: "boolean", description: "Compare with the baseline: the check must fail without the change." },
        baseline: { type: "string", description: "Handle printed by `casper baseline` before the change." },
        requirements: { type: "array", items: { type: "string" }, description: "Requirements declared by the caller, echoed back." },
        path: { type: "string", description: "Workspace folder. Default: the server's working directory." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "run_checks",
    description: "Run the project's checks and return facts, with no proof comparison.",
    inputSchema: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, command: { type: "string" } },
            required: ["command"],
            additionalProperties: false,
          },
        },
        path: { type: "string", description: "Workspace folder. Default: the server's working directory." },
      },
      required: ["commands"],
      additionalProperties: false,
    },
  },
  {
    name: "undo_last",
    description: "Restore the workspace to the last baseline. Files edited after the baseline are never overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        baseline: { type: "string", description: "Handle printed by `casper baseline`. Default: the last one this server saw." },
        path: { type: "string", description: "Workspace folder. Default: the server's working directory." },
      },
      additionalProperties: false,
    },
  },
] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function result(text: string, structured: Record<string, unknown>, failed: boolean): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured, ...(failed ? { isError: true } : {}) };
}

function workspaceOf(args: Record<string, unknown>): string {
  return path.resolve(typeof args.path === "string" && args.path ? args.path : process.cwd());
}

function requirementsOf(args: Record<string, unknown>): Requirement[] {
  const values = Array.isArray(args.requirements) ? args.requirements : [];
  return values.filter((value): value is string => typeof value === "string").map((text) => ({ text, status: "open" as const }));
}

async function openBaseline(workspace: string, args: Record<string, unknown>): Promise<ChangeBaseline | undefined> {
  const handle = typeof args.baseline === "string" && args.baseline ? args.baseline : lastBaseline.get(workspace)?.handle;
  if (!handle) return undefined;
  return ChangeBaseline.open(handle, { pathContext: { home: os.homedir() } });
}

async function verifyTool(args: Record<string, unknown>): Promise<ToolResult> {
  const workspace = workspaceOf(args);
  if (typeof args.command !== "string" || !args.command) throw new Error("command is required");
  const name = typeof args.name === "string" && args.name ? args.name : "test";
  const requireProof = args.require_proof === true;
  const baseline = await openBaseline(workspace, args);
  const checks: CheckSpec[] = [{ name, command: args.command }];

  const evidence = await verifyChange({
    context: { workspace, home: os.homedir(), sandbox: false },
    checks,
    ...(requireProof ? { requireProof: true } : {}),
    ...(baseline ? { baseline } : {}),
    requirements: requirementsOf(args),
  });
  if (baseline) lastBaseline.set(workspace, baseline);

  const proofRequired = requireProof && (!baseline || changesCode(evidence.files));
  const code = evidenceExitCode(evidence, { proofRequired });
  const text = code === EXIT.complete ? formatEvidence(evidence) : formatRefusal(evidence, code);
  return result(text, { exitCode: code, evidence }, code !== EXIT.complete);
}

async function runChecksTool(args: Record<string, unknown>): Promise<ToolResult> {
  const workspace = workspaceOf(args);
  const commands = Array.isArray(args.commands) ? args.commands : [];
  const checks: CheckSpec[] = commands.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    if (typeof item.command !== "string" || !item.command) throw new Error(`commands[${index}].command is required`);
    return { name: typeof item.name === "string" && item.name ? item.name : `check${index + 1}`, command: item.command };
  });
  if (!checks.length) throw new Error("commands must name at least one check");

  const evidence: Evidence = await runChecks({ context: { workspace, home: os.homedir(), sandbox: false }, checks });
  const code = evidenceExitCode(evidence, { proofRequired: false });
  const text = code === EXIT.complete ? formatEvidence(evidence) : formatRefusal(evidence, code);
  return result(text, { exitCode: code, evidence }, code !== EXIT.complete);
}

async function undoTool(args: Record<string, unknown>): Promise<ToolResult> {
  const workspace = workspaceOf(args);
  const baseline = await openBaseline(workspace, args);
  if (!baseline) return result("refused: no baseline to restore", { restored: [], changedSince: [], skipped: [] }, true);

  const restored = await restoreFromBaseline({ workspace, baseline, stateDirectory: STATE_DIR });
  const facts = [
    `restored: ${restored.restored.length ? restored.restored.join(", ") : "none"}`,
    `changed since: ${restored.changedSince.length ? restored.changedSince.join(", ") : "none"}`,
    `skipped: ${restored.skipped.length ? restored.skipped.map((entry) => `${entry.path} (${entry.why})`).join(", ") : "none"}`,
  ].join("\n");
  return result(facts, { ...restored }, false);
}

const server = new Server({ name: "casper-core", version: VERSION }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (request.params.name) {
      case "verify_change": return await verifyTool(args);
      case "run_checks": return await runChecksTool(args);
      case "undo_last": return await undoTool(args);
      default: return result(`refused: unknown tool ${request.params.name}`, { exitCode: EXIT.couldNotRun }, true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result(`refused: ${message}`, { exitCode: EXIT.couldNotRun }, true);
  }
});

await server.connect(new StdioServerTransport());
