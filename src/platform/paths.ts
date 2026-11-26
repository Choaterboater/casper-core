import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOutside } from "./inside";

/**
 * Where a path the AI's file tools name really points. One list of private paths is shared by the
 * file tool gate here and, later, the shell sandbox. The gate is a check before the tool runs, on
 * the resolved path (realpath of the longest part that exists), so a link anywhere in the path counts.
 * It is not a sandbox: a shell command can still read these files (see docs/SECURITY.md).
 */

/** Private places under your home folder: keys, logins and cloud credentials. */
export const PRIVATE_PATHS: readonly string[] = [
  ".ssh", ".aws", ".gnupg", ".config/gh", ".kube", ".docker/config.json", ".netrc", ".git-credentials", ".claude.json", ".mcp.json",
  ".claude/.credentials.json", ".codex/auth.json", ".casper/agent/auth.json", ".casper/mcp-consent.key", ".casper/packs.key", ".casper/network-logins.json", ".casper/mcp-secrets.json", ".pi/agent/auth.json", "Library/Keychains",
  ".config/gcloud", ".azure", ".oci", ".terraform.d/credentials.tfrc.json", ".pgpass", ".npmrc", ".pypirc", ".config/hub",
  ".password-store", ".local/share/keyrings",
  // Casper's own: MCP servers (their tokens), profiles (each may hold an mcp.json) and every project's saved conversations.
  ".casper/mcp.json", ".casper/profiles", ".casper/agent/sessions",
  // The private ssh login's per-run socket folders (src/ssh/askpass.ts).
  ".casper/run",
  // Provider settings, which may hold provider keys.
  ".casper/agent/models.json", ".pi/agent/models.json",
];

/** Places in that list that hold no keys or logins of their own: a refusal says why they are private in these words. */
const OWN_RECORDS: ReadonlySet<string> = new Set([".casper/run", ".casper/agent/sessions"]);
/** Why a place in PRIVATE_PATHS is private, as a refusal says it. */
export function privateReason(entry: string): string {
  return OWN_RECORDS.has(entry) ? "Casper's own records" : "keys and logins";
}

/** Where Claude Code, Codex CLI and GitHub CLI keep a sign-in, each tool's own folder setting first. /login offers
 * them (src/runtime/other-logins.ts); the AI's tools may not read them. */
export function otherLoginPaths(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform,
  home = env.HOME || env.USERPROFILE || os.homedir()) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const ghDir = env.GH_CONFIG_DIR || (env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, "gh")
    : platform === "win32" && env.APPDATA ? path.join(env.APPDATA, "GitHub CLI") : path.join(home, ".config", "gh"));
  return {
    claudeCredentials: path.join(claudeDir, ".credentials.json"),
    // Claude Code keeps its settings file beside the folder, or in CLAUDE_CONFIG_DIR when that is set.
    claudeConfig: env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(home, ".claude.json"),
    codexAuth: path.join(env.CODEX_HOME || path.join(home, ".codex"), "auth.json"),
    ghHosts: path.join(ghDir, "hosts.yml"),
  };
}

/** Those sign-in files where a folder setting or Windows (%APPDATA%\GitHub CLI) puts them outside the home places
 * above: private too. Files, never their folder, so a setting that names the project or home never hides it. */
export function otherLoginFiles(home: string, env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const where = otherLoginPaths(env, platform, home);
  return [...new Set([where.claudeCredentials, where.claudeConfig, where.codexAuth, where.ghHosts].map((file) => path.resolve(file)))]
    .filter((file) => !PRIVATE_PATHS.some((entry) => within(path.join(home, entry), file)));
}

/** Casper's own records: approvals, lab answers, remembered hosts, undo copies; MCP consent and skill trust; the packs
 * you added and their record. */
export const CASPER_PRIVATE_PATHS: readonly string[] = [".casper/projects", ".casper/mcp-consent.json", ".casper/skills-trust.json", ".casper/packs", ".casper/packs.json"];

/** Home files the AI may read but never change: Casper's and Pi's own state, shell start-up files, git's settings. */
export const PROTECTED_WRITE_PATHS: readonly string[] = [
  ".casper", ".pi", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile", ".zshrc", ".zshenv", ".zprofile", ".zlogin",
  ".config/fish", ".gitconfig", ".config/git", ".ssh",
];

export type PathClass = "inside" | "outside" | "linksOut" | "private" | "protected" | "gitInternal";

export interface PathContext {
  /** The project folder the session runs in. */
  root: string;
  home?: string;
  /** Pi's state folder (CASPER_AGENT_DIR): its auth.json is private too. */
  agentDir?: string;
  /** The project's sandbox.denyRead, as absolute paths: private to the file tools as well as to shell commands. */
  denyRead?: readonly string[];
}

const UNICODE_SPACES = /[  -   　]/g;

/** Git Bash, MSYS, Cygwin and WSL drive paths (/c/Users, /mnt/c/Users, /cygdrive/c/Users, /proc/cygdrive/c/Users) as
 * Windows names them (C:\Users). Pi's tools do this on Windows before opening a path, so the checks must too. */
export function windowsShellPath(input: string): string {
  if (!input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return input;
  const match = /^\/(?:mnt\/|(?:proc\/)?cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(input);
  return match ? `${match[1]!.toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}` : input;
}

/** On Windows the shell is Git Bash, whose /tmp is the user's temp folder; Pi's file tools would open /tmp/x as
 * C:\\tmp\\x, a different place. A file tool's /tmp path becomes the temp folder, so the AI finds there what its
 * shell wrote and the reverse. Elsewhere, and for any other path, it is returned as given. */
export function shellTempPath(input: string, platform: NodeJS.Platform = process.platform, temp = os.tmpdir()): string {
  if (platform !== "win32" || !/^\/tmp(?:\/|$)/.test(input)) return input;
  return path.win32.join(temp, input.slice(4).replaceAll("/", "\\"));
}

/** A Windows path that names a drive another way, as that drive's path: a drive's admin share (\\host\C$\Users,
 * \\?\UNC\host\C$\Users) and a device path (\\?\C:\Users, \\.\C:\Users), with either slash. Only for the private-place
 * checks: a share on another machine is not this drive, so a file is never opened by this name. */
function windowsDrivePath(input: string): string {
  if (process.platform !== "win32") return input;
  const match = /^[\\/]{2}(?:[?.][\\/]+(?:UNC[\\/]+)?)?(?:[^\\/]+[\\/]+([a-z])\$|([a-z]):)(?=[\\/]|$)[\\/]*(.*)$/is.exec(input);
  return match ? `${(match[1] ?? match[2])!.toUpperCase()}:\\${match[3]!.replaceAll("/", "\\")}` : input;
}

/** The absolute path a native tool will use for `input`: the same steps as Pi's resolveToCwd. */
export function resolveToolPath(input: string, cwd: string, home = os.homedir()): string {
  let normal = input.replace(UNICODE_SPACES, " ");
  if (normal.startsWith("@")) normal = normal.slice(1);
  if (process.platform === "win32") normal = windowsShellPath(normal);
  if (normal === "~") return home;
  if (normal.startsWith("~/") || (process.platform === "win32" && normal.startsWith("~\\"))) return path.join(home, normal.slice(2));
  if (normal.startsWith("file://")) { try { return fileURLToPath(normal); } catch { /* keep as typed */ } }
  return path.resolve(cwd, normal);
}

/** Windows' own realpath also turns 8.3 short names (C:\Users\RUNNER~1) into the long ones. Node's JS realpath keeps
 * them, so ~/.ssh named through a short name would not match. Other systems keep the JS one. */
const realpath = process.platform === "win32" ? realpathSync.native : realpathSync;

/** realpath of the longest part of the path that exists, with the rest added back. */
export function realpathLongest(absolute: string): string {
  let current = path.resolve(absolute);
  const rest: string[] = [];
  for (;;) {
    try { return path.join(realpath(current), ...rest.reverse()); }
    catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(absolute);
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

const same = (a: string, b: string) => process.platform === "win32" || process.platform === "darwin" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** True when `child` is `parent` or inside it. */
export function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (!relative) return true;
  if (process.platform === "win32" || process.platform === "darwin") {
    const lower = path.relative(parent.toLowerCase(), child.toLowerCase());
    return !isOutside(lower);
  }
  return !isOutside(relative);
}

function variants(absolute: string): string[] {
  const drive = windowsDrivePath(absolute);
  return [...new Set([absolute, realpathLongest(absolute), ...(drive === absolute ? [] : [drive, realpathLongest(drive)])])];
}

/** Private places, each as typed (~/.ssh) and as its absolute paths. */
export interface PrivatePlace {
  shown: string;
  paths: string[];
  /** Why it is private, for the refusal: "keys and logins", or the project's own denyRead. */
  why: string;
  /** Whether a search of a folder that holds it is refused too. Not for a denyRead folder inside the project:
   * a search of the project still runs (the sandbox hides that folder from shell commands). */
  below: boolean;
  /** A part of the place that is not private, by its path inside the place (the browser's pictures under ~/.casper/projects). */
  open?: (inside: string) => boolean;
}

/** The browser tool's pictures, <project state>/browser/..., which it tells the AI to read. */
function browserPictures(inside: string): boolean {
  const parts = inside.split(/[\\/]/);
  return parts.length > 2 && parts[1] === "browser" && !parts.includes("..");
}

export function privatePlaces(context: PathContext): PrivatePlace[] {
  const home = context.home ?? os.homedir();
  const why = "keys and logins";
  const places: PrivatePlace[] = PRIVATE_PATHS.map((entry) => ({ shown: `~/${entry}`, paths: variants(path.join(home, entry)), why: privateReason(entry), below: true }));
  for (const entry of CASPER_PRIVATE_PATHS) {
    const absolute = path.join(home, entry);
    places.push({ shown: `~/${entry}`, paths: variants(absolute), why: "Casper's own records", below: true,
      ...(entry === ".casper/projects" ? { open: browserPictures } : {}) });
  }
  for (const file of otherLoginFiles(home)) {
    places.push({ shown: within(home, file) ? `~/${path.relative(home, file).split(path.sep).join("/")}` : file, paths: variants(file), why, below: true });
  }
  if (context.agentDir) {
    places.push({ shown: "Casper's login file (auth.json)", paths: variants(path.join(context.agentDir, "auth.json")), why, below: true });
    places.push({ shown: "Casper's provider settings (models.json)", paths: variants(path.join(context.agentDir, "models.json")), why, below: true });
    places.push({ shown: "Casper's saved conversations folder", paths: variants(path.join(context.agentDir, "sessions")), why: "Casper's own records", below: true });
  }
  for (const entry of context.denyRead ?? []) {
    const inside = within(context.root, entry);
    const relative = (from: string) => path.relative(from, entry).split(path.sep).join("/");
    const shown = inside ? relative(context.root) || "." : within(home, entry) ? `~/${relative(home)}` : entry;
    places.push({ shown, paths: variants(entry), why: "this project's sandbox.denyRead", below: !inside });
  }
  return places;
}

/** The private place `absolute` is in, if any. */
export function privatePlace(absolute: string, context: PathContext): string | undefined {
  return privatePlaceFor(absolute, context)?.shown;
}

function privatePlaceFor(absolute: string, context: PathContext): PrivatePlace | undefined {
  const candidates = variants(absolute);
  return privatePlaces(context).find((place) => place.paths.some((entry) => candidates.some((candidate) => within(entry, candidate)
    && !place.open?.(path.relative(entry, candidate)))));
}

/** A private place inside the folder `absolute` (grep over ~ would read ~/.ssh). */
export function privatePlaceBelow(absolute: string, context: PathContext): string | undefined {
  const candidates = variants(absolute);
  return privatePlaces(context).find((place) => place.below && place.paths.some((entry) => candidates.some((candidate) => within(candidate, entry))))?.shown;
}

function readText(file: string): string | undefined {
  try { return statSync(file).size > 1024 * 1024 ? undefined : readFileSync(file, "utf8"); } catch { return undefined; }
}

/** The git folders for `root`: its .git (or the folder a .git file points to) and the shared folder of a worktree. */
export function gitDirs(root: string): string[] {
  const dotGit = path.join(root, ".git");
  const dirs: string[] = [];
  let gitDir: string | undefined;
  try {
    if (statSync(dotGit).isDirectory()) gitDir = dotGit;
    else {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? "")?.[1]?.trim();
      if (pointer) gitDir = path.resolve(root, pointer);
    }
  } catch { /* not a git repo */ }
  if (!gitDir) return dirs;
  dirs.push(gitDir);
  const common = readText(path.join(gitDir, "commondir"))?.trim();
  if (common) dirs.push(path.resolve(gitDir, common));
  return dirs;
}

/** Folders a core.hooksPath setting points to, from the repo's and your own git settings. */
export function hooksPathTargets(root: string, home = os.homedir()): string[] {
  const configs = gitDirs(root).flatMap((dir) => [path.join(dir, "config"), path.join(dir, "config.worktree")]);
  configs.push(path.join(home, ".gitconfig"), path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "git", "config"));
  const targets = new Set<string>();
  for (const file of configs) {
    const text = readText(file);
    if (!text) continue;
    for (const match of text.matchAll(/^\s*hookspath\s*=\s*(.+?)\s*$/gim)) {
      let value = match[1]!.replace(/^"(.*)"$/, "$1");
      if (value.startsWith("~/")) value = path.join(home, value.slice(2));
      targets.add(path.resolve(root, value));
    }
  }
  return [...targets];
}

/** Is `absolute` part of git's own files: any .git folder or file, the repo's git folders, or a hooks folder? */
export function gitInternalPart(absolute: string, root: string, home = os.homedir()): string | undefined {
  for (const candidate of variants(absolute)) {
    const parts = candidate.split(/[\\/]+/);
    const index = parts.findIndex((part) => same(part, ".git"));
    if (index >= 0) return parts.slice(index, index + 2).join("/");
  }
  for (const dir of gitDirs(root)) if (variants(absolute).some((candidate) => within(dir, candidate))) return ".git";
  for (const target of hooksPathTargets(root, home)) {
    if (variants(absolute).some((candidate) => variants(target).some((entry) => within(entry, candidate)))) return displayPath(target, root, home);
  }
  return undefined;
}

/** A path as a person would type it: relative inside the project, ~/ under home, absolute otherwise. */
export function displayPath(absolute: string, root: string, home = os.homedir()): string {
  if (within(root, absolute)) return path.relative(root, absolute).split(path.sep).join("/") || ".";
  if (within(home, absolute)) { const relative = path.relative(home, absolute).split(path.sep).join("/"); return relative ? `~/${relative}` : "~"; }
  return absolute;
}

/**
 * What a path is, for the AI's file tools:
 * - private: under a private place (~/.ssh, ~/.aws, Casper's login file ...), by name or through a link;
 * - gitInternal (writes only): any .git folder or file, the repo's git folders, a core.hooksPath folder;
 * - protected (writes only): ~/.casper, ~/.pi, shell start-up files, ~/.gitconfig;
 * - linksOut: named inside the project but a link takes it outside;
 * - inside or outside otherwise.
 */
export function classifyPath(absolute: string, context: PathContext, write: boolean): PathClass {
  const home = context.home ?? os.homedir();
  if (privatePlace(absolute, context)) return "private";
  const real = realpathLongest(absolute);
  if (write && gitInternalPart(absolute, context.root, home)) return "gitInternal";
  const roots = variants(context.root);
  const namedInside = roots.some((root) => within(root, absolute));
  const realInside = roots.some((root) => within(root, real));
  if (namedInside && !realInside) return "linksOut";
  // Where the write lands decides; a name under ~/.pi that is a link into the project is the project.
  // A project that itself lives in one of these places (Casper's own worktrees are in ~/.casper/worktrees)
  // is still the project: only the parts outside it are protected.
  if (write && PROTECTED_WRITE_PATHS.some((entry) => variants(path.join(home, entry))
    .some((place) => !(realInside && roots.some((root) => within(place, root)))
      && (within(place, real) || (!realInside && within(place, absolute)))))) return "protected";
  return realInside ? "inside" : "outside";
}

/** macOS name variants Pi's read also tries (screenshot AM/PM, NFD, curly quote), when they exist. */
export function readVariants(absolute: string): string[] {
  const found = [absolute];
  for (const variant of [absolute.replace(/ (AM|PM)\./gi, " $1."), absolute.normalize("NFD"), absolute.replace(/'/g, "’")]) {
    if (variant !== absolute && existsSync(variant)) found.push(variant);
  }
  return found;
}
