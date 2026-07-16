import { loadRepoRegistry } from "../repos.js";
import { repoState } from "../ingest/github.js";
import type { PlanStep, RunbookOutput } from "./types.js";

/**
 * archive-repos — enforce `disposition: archive` from repos.yaml. Desired
 * state already lives in the registry (manifest-authoritative, I5), so the
 * plan carries no manifest edits: it reads current repo state, plans a PATCH
 * for every candidate not yet archived, and the nightly audit confirms
 * convergence after apply. Archiving is reversible in repo settings.
 */
export async function planArchiveRepos(): Promise<RunbookOutput> {
  const registry = loadRepoRegistry();
  const candidates = registry.repos.filter((r) => r.disposition === "archive");
  if (!candidates.length) throw new Error("no repos.yaml entries with disposition: archive — nothing to plan");

  const steps: PlanStep[] = [];
  const notes: string[] = [];
  for (const c of candidates) {
    const st = await repoState(c.name);
    if ("degraded" in st) throw new Error(`cannot read ${c.name} (${st.reason}) — planning needs read access to current repo state`);
    if (!st.exists) { notes.push(`${c.name}: 404 at GitHub — skipped; remove it from repos.yaml`); continue; }
    if (st.archived) continue; // already converged
    steps.push({
      id: steps.length + 1,
      provider: "github",
      description: `archive ${c.name}${c.note ? ` (${c.note})` : ""} — reversible in repo settings`,
      call: { method: "PATCH", url: `https://api.github.com/repos/${c.name}`, body: { archived: true }, tokenEnv: "GITHUB_TOKEN" },
      expect: [200],
    });
  }
  if (!steps.length) throw new Error("every archive-disposition repo is already archived — nothing to plan");

  return {
    steps,
    edits: [],
    notes: [
      ...notes,
      "Desired state lives in repos.yaml (disposition: archive) — no manifest edits needed; the nightly audit verifies convergence after apply.",
    ],
  };
}
