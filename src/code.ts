/** Paths, for deciding whether a change needs a proof at all. */

/** Tests and their support files (helpers, fixtures under a test directory). They are what proves a
 * change, so the comparison keeps their new version; everything else is the change itself. */
export function isTestPath(relative: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|specs?)\//i.test(relative)
    || /\.(?:test|spec)\.[^/.]+$/i.test(relative)
    || /(?:^|\/)test_[^/]+\.py$/i.test(relative)
    || /_(?:test|spec)\.[^/.]+$/i.test(relative);
}

/** Source code a behavior change lives in (tests excluded). Docs, data, assets and configuration are
 * not: editing them alone needs no proof. */
export function isCodePath(relative: string): boolean {
  return !isTestPath(relative) && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|scala|rb|php|cs|fs|swift|c|cc|cpp|cxx|h|hpp|m|mm|ex|exs|erl|clj|dart|lua|pl|sh|bash|zsh|vue|svelte)$/i.test(relative);
}

/** Never part of a change: VCS internals, Casper's state, installed dependencies and virtual environments. */
const SKIPPED: Record<string, true> = { ".git": true, node_modules: true, ".casper": true, ".venv": true,
  __pycache__: true, ".mypy_cache": true, ".pytest_cache": true, ".ruff_cache": true, ".tox": true };

export interface ChangedPaths {
  added: readonly string[];
  modified: readonly string[];
  removed: readonly string[];
}

/** Whether a set of changes touches code that must be proven. */
export function changesCode(changes: ChangedPaths): boolean {
  return [...changes.added, ...changes.modified, ...changes.removed]
    .some((relative) => isCodePath(relative) && !relative.split("/").some((part) => Object.hasOwn(SKIPPED, part)));
}
