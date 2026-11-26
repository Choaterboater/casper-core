import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import os from "node:os";
import path from "node:path";
import { EXIT } from "../src/evidence";
import { ChangeBaseline } from "../src/verify/proof";
import { BUGGY_SUM, FIXED_SUM, SUM_TEST, removeDir, tempDir, writeFiles } from "./support/fixtures";

const SERVER = path.join(import.meta.dir, "..", "src", "mcp", "server.ts");
const home = os.homedir();

let root: string | undefined;
let client: Client | undefined;
let baseline: ChangeBaseline | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  await baseline?.dispose();
  baseline = undefined;
  await removeDir(root);
  root = undefined;
});

async function project(sum = BUGGY_SUM): Promise<string> {
  root = await tempDir("mcp");
  await writeFiles(root, { "src/sum.js": sum, "tests/sum.test.js": SUM_TEST });
  return root;
}

async function connect(): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  const connected = new Client({ name: "fake-host", version: "0.0.0" });
  await connected.connect(transport);
  client = connected;
  return connected;
}

const exitOf = (result: unknown): number | undefined =>
  (result as { structuredContent?: { exitCode?: number } }).structuredContent?.exitCode;

test("the server lists the four tools", async () => {
  const connected = await connect();
  const listed = await connected.listTools();
  expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["capture_baseline", "run_checks", "undo_last", "verify_change"]);
});

test("capture_baseline returns a handle the gate can prove with", async () => {
  const workspace = await project();
  const connected = await connect();
  const captured = await connected.callTool({ name: "capture_baseline", arguments: { path: workspace, command: "bun test" } });
  expect(captured.isError).toBeFalsy();
  const handle = (captured.structuredContent as { baseline: string }).baseline;
  expect((captured.content as Array<{ text: string }>)[0]!.text).toBe(`baseline: ${handle}`);
  baseline = await ChangeBaseline.open(handle, { pathContext: { home } });

  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });
  const result = await connected.callTool({
    name: "verify_change",
    arguments: { path: workspace, command: "bun test", require_proof: true, baseline: handle },
  });
  expect(exitOf(result)).toBe(EXIT.complete);
  expect(result.isError).toBeFalsy();
});

test("run_checks reports a failing check as a refusal", async () => {
  const workspace = await project();
  const connected = await connect();
  const result = await connected.callTool({ name: "run_checks", arguments: { path: workspace, commands: [{ name: "test", command: "bun test" }] } });
  expect(exitOf(result)).toBe(EXIT.checksFailed);
  expect(result.isError).toBe(true);
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain("refused: a check failed");
  expect(text).toContain("exit: 1");
});

test("a proven change returns evidence and the host may claim it", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });
  const connected = await connect();

  const result = await connected.callTool({
    name: "verify_change",
    arguments: { path: workspace, command: "bun test", require_proof: true, baseline: baseline.handle },
  });

  expect(exitOf(result)).toBe(EXIT.complete);
  expect(result.isError).toBeFalsy();
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain("proof: the check fails without the change and passes with it");
  expect(text).toContain("exit: 0");
  expect(text).not.toMatch(/Verified|Done/);

  // What a host following the skill does with the answer.
  const host = { claimedDone: exitOf(result) === EXIT.complete };
  expect(host.claimedDone).toBe(true);
});

test("an unproven change is refused and the host does not claim it", async () => {
  const workspace = await project(FIXED_SUM);
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  await writeFiles(workspace, { "src/unused.js": "export const unused = 1;\n" });
  const connected = await connect();

  const result = await connected.callTool({
    name: "verify_change",
    arguments: { path: workspace, command: "bun test", require_proof: true, baseline: baseline.handle },
  });

  expect(exitOf(result)).toBe(EXIT.unproven);
  expect(result.isError).toBe(true);
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain("refused: the change is not proven");
  // The host has no shell, so the code must be quotable from the text alone.
  expect(text).toContain("exit: 2");

  const host = { claimedDone: exitOf(result) === EXIT.complete };
  expect(host.claimedDone).toBe(false);
});

test("undo_last puts the workspace back to the baseline", async () => {
  const workspace = await project();
  baseline = await ChangeBaseline.capture(workspace, { command: "bun test", pathContext: { home } });
  await writeFiles(workspace, { "src/sum.js": FIXED_SUM });
  const connected = await connect();

  // verify_change remembers the baseline for this workspace.
  await connected.callTool({
    name: "verify_change",
    arguments: { path: workspace, command: "bun test", require_proof: true, baseline: baseline.handle },
  });

  const undone = await connected.callTool({ name: "undo_last", arguments: { path: workspace } });
  expect(undone.isError).toBeFalsy();
  const structured = undone.structuredContent as { restored: string[] } | undefined;
  expect(structured?.restored).toContain("src/sum.js");
  expect(await Bun.file(path.join(workspace, "src", "sum.js")).text()).toBe(BUGGY_SUM);
});

test("undo_last with no baseline is refused", async () => {
  const workspace = await project(FIXED_SUM);
  const connected = await connect();
  const result = await connected.callTool({ name: "undo_last", arguments: { path: workspace } });
  expect(result.isError).toBe(true);
  expect((result.content as Array<{ text: string }>)[0]!.text).toContain("refused: no baseline");
});
