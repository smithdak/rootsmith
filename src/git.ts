import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function git(args: string[], opts: { input?: string; env?: Record<string, string> } = {}): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    input: opts.input,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function gitTry(args: string[]): string | undefined {
  try { return git(args); } catch { return undefined; }
}

/** File content at HEAD (raw, untrimmed); undefined when the path is not tracked. */
export function showFileAtHead(path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch { return undefined; }
}

/** owner/repo from the Actions env or the origin remote; undefined when neither exists. */
export function repoSlug(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = gitTry(["remote", "get-url", "origin"]);
  const m = url?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m?.[1];
}

export interface CommitResult {
  commit: string;
  pushed: boolean;
  unchanged?: boolean;
  pushError?: string;
}

/**
 * Commit files onto a remote branch WITHOUT touching the working tree, index,
 * or current branch — pure plumbing against a temporary index. This is what
 * lets drift auto-PRs and plan PRs run from a dirty checkout or a detached
 * Actions HEAD with zero cleanup obligations.
 */
export function commitFilesToBranch(opts: {
  branch: string;
  message: string;
  files: { path: string; content: string }[]; // repo-relative, forward slashes
  baseRef?: string;
}): CommitResult {
  let base: string;
  try {
    base = git(["rev-parse", opts.baseRef ?? "HEAD"]);
  } catch {
    throw new Error(`cannot resolve ${opts.baseRef ?? "HEAD"} — does the repo have an initial commit yet?`);
  }
  const dir = mkdtempSync(join(tmpdir(), "rootsmith-git-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    git(["read-tree", base], { env });
    for (const f of opts.files) {
      const blob = git(["hash-object", "-w", "--stdin"], { input: f.content });
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], { env });
    }
    const tree = git(["write-tree"], { env });
    if (tree === git(["rev-parse", `${base}^{tree}`])) return { commit: base, pushed: false, unchanged: true };
    const identity = {
      GIT_AUTHOR_NAME: "rootsmith", GIT_AUTHOR_EMAIL: "rootsmith@users.noreply.github.com",
      GIT_COMMITTER_NAME: "rootsmith", GIT_COMMITTER_EMAIL: "rootsmith@users.noreply.github.com",
    };
    const commit = git(["commit-tree", tree, "-p", base, "-m", opts.message], { env: { ...env, ...identity } });
    try {
      git(["push", "-f", "origin", `${commit}:refs/heads/${opts.branch}`]);
      return { commit, pushed: true };
    } catch (e) {
      return { commit, pushed: false, pushError: (e as Error).message.split("\n")[0] };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
