/** Minimal GitHub REST client for the control repo itself: drift issues,
 *  auto-PRs, plan PRs. World-mutating GitHub calls (create/archive repos)
 *  never go through here — they are plan steps executed by the apply path. */

import { execFileSync } from "node:child_process";

let cliToken: string | null | undefined; // undefined = unprobed, null = unavailable

export function ghToken(): string | undefined {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  if (cliToken === undefined) {
    try {
      cliToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() || null;
    } catch {
      cliToken = null; // no gh CLI / not logged in — callers degrade
    }
  }
  return cliToken ?? undefined;
}

export async function gh(
  repo: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; json: any }> {
  const token = ghToken();
  if (!token) throw new Error("GITHUB_TOKEN not set");
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "rootsmith/0.1",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

/** Idempotent: 422 = label already exists, which is the steady state. */
export async function ensureLabel(repo: string, name: string, color: string, description: string): Promise<void> {
  const r = await gh(repo, "/labels", { method: "POST", body: { name, color, description } });
  if (r.status !== 201 && r.status !== 422) {
    console.error(`warning: could not ensure label ${name}: HTTP ${r.status}`);
  }
}

export async function defaultBranch(repo: string): Promise<string> {
  const r = await gh(repo, "");
  if (r.status !== 200) throw new Error(`cannot read repo ${repo}: HTTP ${r.status}`);
  return r.json.default_branch as string;
}

/** One open PR per head branch: update in place if it exists (dedup posture
 *  mirrors the issue fingerprint rule — never file a duplicate). */
export async function openOrUpdatePr(
  repo: string,
  opts: { head: string; title: string; body: string; label: string }
): Promise<{ url: string; created: boolean }> {
  const owner = repo.split("/")[0]!;
  const existing = await gh(repo, `/pulls?head=${owner}:${encodeURIComponent(opts.head)}&state=open`);
  if (Array.isArray(existing.json) && existing.json.length) {
    const pr = existing.json[0];
    await gh(repo, `/pulls/${pr.number}`, { method: "PATCH", body: { title: opts.title, body: opts.body } });
    return { url: pr.html_url, created: false };
  }
  const base = await defaultBranch(repo);
  const r = await gh(repo, "/pulls", {
    method: "POST",
    body: { title: opts.title, head: opts.head, base, body: opts.body },
  });
  if (r.status !== 201) {
    throw new Error(`PR create failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  await gh(repo, `/issues/${r.json.number}/labels`, { method: "POST", body: { labels: [opts.label] } });
  return { url: r.json.html_url, created: true };
}
