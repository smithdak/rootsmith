/**
 * GitHub reader — repo existence, archived-status, and the full owned-repo
 * inventory. Archived-status is manifest-authoritative (drift here proposes
 * fixing the world, I5); the account sweep feeds the I1 unmanifested audit.
 *
 * Read token resolution: GH_REPOS_TOKEN (nightly: a fine-grained read PAT —
 * github.token cannot see beyond the control repo) falls back to
 * GITHUB_TOKEN/gh-CLI for local use.
 */
import { ghToken } from "../gh.js";

const readToken = () => process.env.GH_REPOS_TOKEN || ghToken();

export interface RepoFacts {
  fullName: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
  defaultBranch?: string;
  pushedAt?: string;
}

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "rootsmith/0.1",
});

export type RepoStateResult =
  | { degraded: true; reason: string }
  | { exists: false }
  | { exists: true; archived: boolean; defaultBranch: string; fork: boolean; private: boolean };

export async function repoState(fullName: string, token = readToken()): Promise<RepoStateResult> {
  if (!token) return { degraded: true, reason: "no GitHub token (set GH_REPOS_TOKEN/GITHUB_TOKEN or `gh auth login`)" };
  const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers: headers(token) });
  if (res.status === 404) return { exists: false };
  if (!res.ok) return { degraded: true, reason: `HTTP ${res.status}` };
  const j = (await res.json()) as { archived: boolean; default_branch: string; fork: boolean; private: boolean };
  return { exists: true, archived: j.archived, defaultBranch: j.default_branch, fork: j.fork, private: j.private };
}

/** Every repo OWNED by the token's user (org repos are auditable when a
 *  venture claims them, but only owned repos are swept for I1). */
export async function listRepos(token = readToken()): Promise<{ ok: true; repos: RepoFacts[] } | { ok: false; reason: string }> {
  if (!token) return { ok: false, reason: "no GitHub token (set GH_REPOS_TOKEN/GITHUB_TOKEN or `gh auth login`)" };
  try {
    const repos: RepoFacts[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed`,
        { headers: headers(token) }
      );
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const batch = (await res.json()) as {
        full_name: string; archived: boolean; fork: boolean; private: boolean;
        default_branch: string; pushed_at?: string;
      }[];
      for (const r of batch) {
        repos.push({
          fullName: r.full_name,
          archived: r.archived,
          fork: r.fork,
          private: r.private,
          defaultBranch: r.default_branch,
          pushedAt: r.pushed_at,
        });
      }
      if (batch.length < 100) break;
    }
    return { ok: true, repos };
  } catch (e) {
    return { ok: false, reason: `fetch failed: ${(e as Error).message}` };
  }
}
