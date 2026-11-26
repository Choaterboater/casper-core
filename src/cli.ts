#!/usr/bin/env bun
import os from "node:os";
import path from "node:path";
import { changesCode } from "./code";
import { EXIT, evidenceExitCode, type Requirement } from "./evidence";
import { formatEvidence, formatRefusal } from "./format";
import { snapshotTree } from "./task/changes";
import { verifyChange, type CheckSpec } from "./verify/gate";
import { ChangeBaseline } from "./verify/proof";

const USAGE = `casper-core: an evidence gate.

  casper baseline [--path <dir>] [--command <cmd>] [--json]
      Copy the workspace before a change and print the handle to pass to verify.

  casper verify --command <cmd> [--name <check>] [--require-proof]
                [--baseline <handle>] [--requirement <text>] [--path <dir>]
                [--json] [--discard]
      Run the checks and print the facts.

Exit codes: 0 evidence complete, 1 checks failed, 2 unproven, 3 could not run.`;

interface Options {
  workspace: string;
  commands: string[];
  names: string[];
  requireProof: boolean;
  baseline?: string;
  requirements: Requirement[];
  json: boolean;
  discard: boolean;
}

function parse(argv: string[]): Options {
  const options: Options = {
    workspace: process.cwd(), commands: [], names: [], requireProof: false, requirements: [], json: false, discard: false,
  };
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    switch (arg) {
      case "--path": options.workspace = path.resolve(value(index, arg)); index++; break;
      case "--command": options.commands.push(value(index, arg)); index++; break;
      case "--name": options.names.push(value(index, arg)); index++; break;
      case "--baseline": options.baseline = value(index, arg); index++; break;
      case "--requirement": options.requirements.push({ text: value(index, arg), status: "open" }); index++; break;
      case "--require-proof": options.requireProof = true; break;
      case "--json": options.json = true; break;
      case "--discard": options.discard = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

async function baseline(options: Options): Promise<number> {
  const home = os.homedir();
  const copy = await ChangeBaseline.capture(options.workspace, {
    command: options.commands[0] ?? "",
    pathContext: { home },
  });
  const files = (await snapshotTree(copy.beforeTree, undefined, { git: false })).size;
  if (options.json) {
    console.log(JSON.stringify({ handle: copy.handle, files }));
  } else {
    console.log(`baseline: ${copy.handle}`);
    console.log(`files: ${files}`);
  }
  return EXIT.complete;
}

async function verify(options: Options): Promise<number> {
  if (!options.commands.length) throw new Error("verify needs at least one --command");
  const checks: CheckSpec[] = options.commands.map((command, index) => ({
    name: options.names[index] ?? (options.commands.length === 1 ? "test" : `check${index + 1}`),
    command,
  }));
  const home = os.homedir();
  let copy: ChangeBaseline | undefined;
  if (options.baseline) copy = await ChangeBaseline.open(options.baseline, { pathContext: { home } });

  const evidence = await verifyChange({
    context: { workspace: options.workspace, home, sandbox: false },
    checks,
    ...(options.requireProof ? { requireProof: true } : {}),
    ...(copy ? { baseline: copy } : {}),
    requirements: options.requirements,
  });

  // Proof is required when asked for and the change touches code. Without a baseline the files are
  // unknown, so the requirement stands and the missing proof is what refuses.
  const proofRequired = options.requireProof && (!copy || changesCode(evidence.files));
  const code = evidenceExitCode(evidence, { proofRequired });

  if (options.json) console.log(JSON.stringify({ ...evidence, exitCode: code }));
  else console.log(code === EXIT.complete ? formatEvidence(evidence) : formatRefusal(evidence, code));

  if (options.discard && copy) await copy.dispose();
  return code;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command) { console.log(USAGE); return EXIT.couldNotRun; }
  if (command === "--help" || command === "-h" || command === "help") { console.log(USAGE); return EXIT.complete; }
  const options = parse(rest);
  if (command === "baseline") return baseline(options);
  if (command === "verify") return verify(options);
  throw new Error(`unknown command: ${command}`);
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(`refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT.couldNotRun;
});
