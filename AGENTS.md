# Notes for coding agents

casper-core is a gate and an evidence engine, not an agent and not a platform. The non-goals in [README.md](README.md) are the point of the repository; a change that erodes them is a regression even when the tests pass.

## Commands

```sh
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint
bun test            # tests/
bun run check       # all three
```

## Commits

- Commits are authored by the repository owner only: `Choaterboater <280862039+Choaterboater@users.noreply.github.com>`. Check `git config user.name` before committing.
- Never add `Co-Authored-By` lines, session links, or tool attribution to commits, pull requests, or comments.

## Guardrails

- Do not add a check because a change looks risky. Add it only if the action is irreversible or outside the user's authority.
- Do not write a test that only asserts a gate exists. Test the user outcome: zero boxes, one box, refusal.
- Do not add a config key without an off switch and a scope.
- Do not grow a prompt. If a feature needs prompt text, it is a skill.
- When in doubt, compare to Claude Code and copy its shape, not its features.
- Do not re-add a platform to make the gate feel complete. If a feature does not make the gate harder to fool, it belongs in a skill.
- Do not adopt LangChain, Vercel AI SDK, or another agent framework as the foundation. If a model call is needed, define a small `ModelClient` and ship one adapter.
- The kernel must not import from the CLI, the MCP server, or any UI.
- Source stays under 15k lines and tests under 100 files. A pull request that grows either needs a written exception.

## Tests

- Test the evidence and the policy, not the screen. Do not port terminal, browser, or process-timing tests from the predecessor.
- No known-flaky list. A flaky test is fixed or deleted before merge.
- Windows, macOS, and Linux are all supported; do not depend on developer git config, `HOME`, or terminal state.
