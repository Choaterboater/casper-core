import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { UndoStore } from "../src/task/undo";
import { removeDir, tempDir, writeFiles } from "./support/fixtures";

let root: string | undefined;
let state: string | undefined;

afterEach(async () => {
  await removeDir(root);
  await removeDir(state);
  root = state = undefined;
});

async function project(): Promise<UndoStore> {
  root = await tempDir("undo-work");
  state = await tempDir("undo-state");
  await writeFiles(root, { "a.js": "one\n", "b.js": "two\n" });
  return new UndoStore({ stateDirectory: state, root });
}

test("undo puts modified, removed and added files back", async () => {
  const store = await project();
  const before = await store.snapshot();
  if (!("tree" in before)) throw new Error(`snapshot unavailable: ${before.unavailable}`);

  await writeFile(path.join(root!, "a.js"), "changed\n");
  await rm(path.join(root!, "b.js"));
  await writeFile(path.join(root!, "c.js"), "new\n");

  const after = await store.snapshot();
  if (!("tree" in after)) throw new Error(`snapshot unavailable: ${after.unavailable}`);

  const plan = await store.plan(after.tree, before.tree);
  expect(plan.ready.map((change) => change.path).sort()).toEqual(["a.js", "b.js", "c.js"]);

  const applied = await store.apply(plan.ready, before.tree);
  expect(applied.restored.sort()).toEqual(["a.js", "b.js", "c.js"]);
  expect(await readFile(path.join(root!, "a.js"), "utf8")).toBe("one\n");
  expect(await readFile(path.join(root!, "b.js"), "utf8")).toBe("two\n");
  await expect(readFile(path.join(root!, "c.js"), "utf8")).rejects.toThrow();
});

test("a file changed since the plan is left alone", async () => {
  const store = await project();
  const before = await store.snapshot();
  if (!("tree" in before)) throw new Error("snapshot unavailable");

  await writeFile(path.join(root!, "a.js"), "changed\n");
  const after = await store.snapshot();
  if (!("tree" in after)) throw new Error("snapshot unavailable");

  // Someone edits the file again after the plan was made from `before`.
  await writeFile(path.join(root!, "a.js"), "changed again\n");

  const plan = await store.plan(after.tree, before.tree);
  expect(plan.changedSince).toContain("a.js");
  expect(plan.ready.some((change) => change.path === "a.js")).toBe(false);

  const applied = await store.apply(plan.ready, before.tree);
  expect(applied.restored).not.toContain("a.js");
  expect(await readFile(path.join(root!, "a.js"), "utf8")).toBe("changed again\n");
});

test("secret files are never copied into the undo store", async () => {
  const store = await project();
  await writeFile(path.join(root!, ".env"), "API_KEY=sk-not-real\n");
  const snapshot = await store.snapshot();
  if (!("tree" in snapshot)) throw new Error("snapshot unavailable");
  expect(snapshot.left.some((entry) => entry.path === ".env" && entry.why === "secret")).toBe(true);
  expect(await store.files(snapshot.tree)).not.toContain(".env");
});
