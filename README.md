# casper-core

An external agent asks casper-core to verify a change, and casper-core answers with evidence or refuses.

casper-core is not an agent. It does not plan, chat, or repair on its own. It is a gate and an evidence engine that any agent can call, over a CLI or an MCP tool.

## Status

Phase 2: the kernel, the gate, the facts-only formatter, and the CLI work on a local workspace. The MCP server and skill pack land in Phase 4. Do not depend on this repository before 0.1.0.

## What it does

- Runs the project's own checks, not checks it invents.
- Proves the change matters: the check fails without the change and passes with it.
- Prints facts only: which checks ran, pass and fail counts, whether the proof held, which files changed, which declared requirements are still open.
- Refuses. The gate has no path from `working` to `done` without evidence.

## Usage

Capture the workspace before the change:

```sh
casper baseline --command "bun test"
# baseline: /tmp/casper-baseline-xxxx
# files: 42
```

Make the change, then verify it:

```sh
casper verify --command "bun test" --require-proof --baseline /tmp/casper-baseline-xxxx
```

```text
checks: test pass (1/1)
proof: the check fails without the change and passes with it
files: src/sum.js
open requirements: none declared
```

A change the tests do not notice is refused with exit `2`:

```text
refused: the change is not proven
checks: test pass (1/1)
proof: the check passes without the change
files: +src/helper.js
open requirements: none declared
```

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | evidence complete |
| `1` | checks failed |
| `2` | unproven: checks pass, proof missing or failed |
| `3` | could not run: no command, no baseline, environment problem |

## Non-goals

casper-core will not grow into a platform. Not in 0.1.0, not later:

- No agent loop, no model provider, no prompt of its own.
- No terminal UI, browser, editor, LSP, debugger, or pages.
- No ACP, services, crews, learning, memory, flows, packs, or `/look`.
- No GitHub integration, release bot, or nightly treadmill.
- No receipt verdicts: no completion claim, no checkmark, no folded one-line summary.
- No per-action approval boxes: one broker, three outcomes, three modes, batched asks.
- No gate that is stricter than Claude Code's for the same action.

Why the scope is this narrow: [docs/WHY.md](docs/WHY.md).

## The evidence contract

```ts
export interface Evidence {
  checks: Array<{ name: string; status: "pass" | "fail" | "blocked" | "skipped"; detail?: string }>;
  proof?: { status: "proven" | "unproven" | "unavailable"; reason?: string };
  files: { added: string[]; modified: string[]; removed: string[] };
  requirements: Array<{ text: string; status: "open" | "done" }>;
  ranAt: string;
}
```

`requirements` is declared by the caller. casper-core never infers it.

## Development

```sh
bun install
bun run check
```

`bun run check` is typecheck, lint, and tests. There is no known-flaky list: a flaky test is fixed or deleted.

The predecessor repository is archived at [github.com/Choaterboater/casper](https://github.com/Choaterboater/casper). Tag `v0.4.13` is the reference for the kernel this repository ports.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
