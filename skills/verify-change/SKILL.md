---
name: verify-change
description: Verify a change with casper-core before claiming it works. Use when finishing a code change, before writing any completion message.
---

# Verify a change before claiming it works

casper-core is an evidence gate. It runs the project's own checks and proves the change matters. It prints facts; it never prints a verdict.

## Before the change

Capture the workspace so the gate has something to compare with:

```sh
casper baseline --command "<the project's test command>"
```

Keep the `baseline:` handle. It is a folder path.

## After the change

Call the `verify_change` tool:

```json
{
  "command": "<the project's test command>",
  "require_proof": true,
  "baseline": "<the handle>"
}
```

## Reading the answer

- `isError` false and `exitCode` 0: the checks passed and the check fails without the change. You may quote the facts.
- `exitCode` 1: a check failed. Fix it or report it.
- `exitCode` 2: the change is not proven. The check passes without it. Add a test that exercises the change, or say the behavior is unverified.
- `exitCode` 3: the checks could not run (no baseline, no command, environment problem). Fix the setup first.

When `isError` is true, do not claim the change works. Quote the facts the tool returned and say what remains.

Never write "done", "verified", or "fixed" when the gate refused. The gate's facts are safe to quote; a completion claim is not.
