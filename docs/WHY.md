# Why casper-core exists

Casper was a coding agent. It worked. The problem was never the model loop or the feature list; it was that the feature list never stopped growing, and none of it made the central claim easier to trust.

This repository extracts the one part that did: **the evidence gate**. The agent must not claim a change is done until the project's checks pass and the tests fail without the change. Everything else is left behind.

## The scope post-mortem

Release-to-release, from the predecessor repository's history:

| Range | Commits | Files | Lines |
|---|---:|---:|---:|
| v0.4.12 -> v0.4.13 | 2 | 32 | +337 / -94 |
| **v0.4.13 -> v0.4.14** | **39** | **339** | **+22,896 / -1,252** |
| v0.4.14 -> v0.4.15 | 8 | 54 | +1,292 / -183 |
| v0.4.15 -> v0.4.16 | 8 | 40 | +446 / -113 |
| v0.4.16 -> v0.4.17 | 5 | 28 | +142 / -81 |

v0.4.14 is the step that matters. That is where ACP landed and the project stopped being an agent and became a platform. At its last commit the repository carried roughly 103k lines in `src/`, 690 test files, 120k lines of tests, 152 Markdown documents, and a permanent known-flaky list.

That is platform-scale maintenance for a single owner. Typecheck, lint, and CI were green the whole time. Green checks were not the problem, and adding more of them would not have been the answer.

## What was decided

1. **A new repository.** Port the kernel, rewrite the seams. The old repository is archived, not deleted; tag `v0.4.13` (commit `501a76ec`) is the reference.
2. **No model loop in core.** The host agent owns the loop. Repair is host-driven or an optional `ModelClient`, never the core.
3. **Facts only.** No verdict words, no checkmark, no folded summary. The gate returns evidence or refuses.
4. **One approval broker.** Three outcomes (allow, ask, deny), three modes (read-only, ask, auto), three scopes (once, session, project).
5. **Never gate harder than Claude Code.** Enforced by a parity test, not by prose.
6. **No platform.** No ACP, terminal UI, browser, services, crews, learning, `/look`, pages, GitHub, LSP, debugger, references, packs, memory, or flows.
7. **Target size:** under 15k source lines and under 100 test files.
8. **One release a month.** A flaky test is fixed or deleted; there is no known-flaky list.

The predecessor repository is kept, read-only, at [github.com/Choaterboater/casper](https://github.com/Choaterboater/casper). It is not broken and it is not being repaired in place: `CasperApp`, `CommandHost`, and the 1,861-line `src/runtime/pi.ts` make that surgery worse than extraction.

## The risk this document exists to prevent

The moment the gate works, someone will want a UI, a browser, and a `/look`. The platform does not arrive as a decision; it arrives one reasonable feature at a time.

Pi was not the villain. Scope was. Moving off Pi without these non-goals would rebuild the same product on a different loop.

So: if a feature does not make the gate harder to fool, it belongs in a skill, not in this repository.
