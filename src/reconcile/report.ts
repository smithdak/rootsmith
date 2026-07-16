import type { Drift } from "./diff.js";
import { commitFilesToBranch, repoSlug, showFileAtHead } from "../git.js";
import { gh, ghToken, ensureLabel, openOrUpdatePr } from "../gh.js";

/** Render the drift set as markdown (job summaries, degraded mode). */
export function toMarkdown(drifts: Drift[]): string {
  if (!drifts.length) return "No drift. The map matches the territory.";
  const lines = ["| tier | asset | kind | detail |", "|---|---|---|---|"];
  for (const d of drifts) lines.push(`| ${d.tier} | ${d.asset} | **${d.kind}** | ${d.detail} |`);
  return lines.join("\n");
}

const MARKER = (fp: string) => `<!-- rootsmith:fingerprint=${fp} -->`;

/**
 * File drift with the dedup rule from spec §4: fingerprint = asset + type;
 * a new occurrence updates the existing open issue/PR, never duplicates it.
 *  - drift WITHOUT a fix  -> GitHub issue (manifest-authoritative: fix the world)
 *  - drift WITH a fix     -> auto-PR editing the manifest (reality-authoritative)
 * Missing token/repo degrades to printing markdown — the run never breaks (I6).
 */
export async function reportDrift(drifts: Drift[], opts: { log?: (s: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((s: string) => console.error(s));
  const repo = repoSlug();
  if (!repo || !ghToken()) {
    log("report: no GITHUB_TOKEN or repo slug — degraded to markdown output");
    console.log(toMarkdown(drifts));
    return;
  }

  await ensureLabel(repo, "drift", "d93f0b", "filed by the rootsmith nightly reconcile");

  const open = await gh(repo, "/issues?labels=drift&state=open&per_page=100");
  const byFingerprint = new Map<string, { number: number }>();
  for (const it of Array.isArray(open.json) ? open.json : []) {
    const m = (it.body ?? "").match(/rootsmith:fingerprint=(\S+) -->/);
    if (m) byFingerprint.set(m[1]!, it);
  }

  for (const d of drifts.filter((d) => !d.fix)) {
    const body = issueBody(d);
    const existing = byFingerprint.get(d.fingerprint);
    if (existing) {
      await gh(repo, `/issues/${existing.number}`, { method: "PATCH", body: { body } });
      log(`updated issue #${existing.number} (${d.fingerprint})`);
    } else {
      const r = await gh(repo, "/issues", {
        method: "POST",
        body: { title: `[drift] ${d.asset}: ${d.kind}`, body, labels: ["drift"] },
      });
      if (r.status === 201) log(`filed issue #${r.json.number} (${d.fingerprint})`);
      else log(`FAILED to file issue for ${d.fingerprint}: HTTP ${r.status}`);
    }
  }

  for (const d of drifts.filter((d) => d.fix)) {
    const fix = d.fix!;
    const current = showFileAtHead(fix.file);
    let next: string;
    try {
      next = fix.mutate(current);
    } catch (e) {
      log(`auto-PR skipped for ${d.fingerprint}: ${(e as Error).message}`);
      continue;
    }
    if (next === current) continue;
    const branch = `rootsmith/fix/${d.fingerprint.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
    const res = commitFilesToBranch({
      branch,
      message: `fix(manifest): ${d.fingerprint}\n\n${d.detail}`,
      files: [{ path: fix.file, content: next }],
    });
    if (res.unchanged) continue;
    if (!res.pushed) {
      log(`auto-PR skipped for ${d.fingerprint}: push failed (${res.pushError})`);
      continue;
    }
    const pr = await openOrUpdatePr(repo, {
      head: branch,
      title: `[drift] auto-fix manifest: ${d.fingerprint}`,
      body: `${MARKER(d.fingerprint)}\n${fix.description}\n\n${d.detail}\n\n*Reality-authoritative drift (I5): the world owns this fact; this PR makes the manifest agree. Opened by the nightly reconcile; updated in place on re-occurrence, never duplicated.*`,
      label: "drift",
    });
    log(`${pr.created ? "opened" : "updated"} auto-PR ${pr.url} (${d.fingerprint})`);
  }
}

function issueBody(d: Drift): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    MARKER(d.fingerprint),
    `| field | value |`,
    `|---|---|`,
    `| tier | ${d.tier} |`,
    `| asset | ${d.asset} |`,
    `| kind | ${d.kind} |`,
    ``,
    d.detail,
    ``,
    `*Last observed ${today}. Fingerprint-deduped (spec §4): this issue is updated in place, never duplicated. Manifest-authoritative drift proposes fixing the world — close it by changing reality (or explicitly amending the manifest), not by ignoring it.*`,
  ].join("\n");
}
