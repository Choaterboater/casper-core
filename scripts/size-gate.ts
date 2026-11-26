/** The size gate: source stays under 15k lines and tests under 100 files. A pull request that
 * grows either needs a written exception, which means changing these numbers in the open. */

import path from "node:path";

const SOURCE_LIMIT = 15_000;
const TEST_FILE_LIMIT = 100;

const root = path.join(import.meta.dir, "..");

async function lines(glob: string): Promise<{ files: number; lines: number }> {
  let files = 0;
  let count = 0;
  for await (const file of new Bun.Glob(glob).scan({ cwd: root })) {
    files++;
    const text = await Bun.file(path.join(root, file)).text();
    count += text.length ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
  }
  return { files, lines: count };
}

const source = await lines("src/**/*.ts");
const tests = await lines("tests/**/*.test.ts");

const failures: string[] = [];
if (source.lines > SOURCE_LIMIT) failures.push(`source is ${source.lines} lines, over the ${SOURCE_LIMIT} limit`);
if (tests.files > TEST_FILE_LIMIT) failures.push(`tests are ${tests.files} files, over the ${TEST_FILE_LIMIT} limit`);

console.log(`size gate: ${source.lines}/${SOURCE_LIMIT} source lines in ${source.files} files; ${tests.files}/${TEST_FILE_LIMIT} test files`);
if (failures.length) {
  for (const failure of failures) console.error(`size gate: ${failure}`);
  process.exitCode = 1;
}
