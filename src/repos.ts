import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { LoadedVenture } from "./manifest.js";
import { listRepos, repoState, type RepoFacts } from "./ingest/github.js";
import { loadVenturesWithFiles } from "./manifest.js";
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

/**
 * The GitHub repo registry — I1 extended to repos: every owned repo either
 * belongs to exactly one venture (its manifest's repo: field) or carries an
 * explicit disposition here. A repo in neither place is drift.
 *
 * Dispositions are DESIRED state (manifest-authoritative, I5):
 *   keep       — stays un-archived; observed archived => mismatch issue
 *   archive    — should be archived; `runbook plan archive-repos` enforces,
 *                the nightly audit confirms convergence
 *   ignore     — not reconciled (I4 posture for repos you won't manage)
 *   unassigned — quarantined by the nightly sweep; triage me
 */
export interface RepoEntry {
  name: string; // owner/repo
  disposition: "keep" | "archive" | "ignore" | "unassigned";
  note?: string;
}

export interface RepoRegistry {
  repos: RepoEntry[];
  notes?: string;
}

export const REPOS_FILE = "repos.yaml"; // repo-relative — git edits target this

const schema = JSON.parse(readFileSync(new URL("../schema/repos.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateRegistry = ajv.compile<RepoRegistry>(schema);

const DEFAULT_PATH = fileURLToPath(new URL(`../${REPOS_FILE}`, import.meta.url));

/** Absent file = empty registry (the sweep will populate it by auto-PR). */
export function loadRepoRegistry(path = DEFAULT_PATH): RepoRegistry {
  if (!existsSync(path)) return { repos: [] };
  const doc = yaml.load(readFileSync(path, "utf8"), { schema: yaml.JSON_SCHEMA });
  if (!validateRegistry(doc)) throw new Error(`repos.yaml validation failed: ${ajv.errorsText(validateRegistry.errors)}`);
  return doc;
}

/** owner/name pairs claimed by venture manifests via their repo: field.
 *  Unparseable values (e.g. provision's github.com/<owner>/x placeholder)
 *  are skipped until the operator fills them in. */
export function claimedRepos(loaded: LoadedVenture[]): { venture: string; fullName: string }[] {
  const out: { venture: string; fullName: string }[] = [];
  for (const { venture } of loaded) {
    const m = venture.repo?.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
    if (m) out.push({ venture: venture.name, fullName: m[1]! });
  }
  return out;
}

const REGISTRY_HEADER = [
  "# GitHub repo registry — I1 extended to repos: every owned repo either belongs",
  "# to exactly one venture manifest (repo: field) or carries a disposition here.",
  "#   keep       — stays un-archived, not venture-tied",
  "#   archive    — desired archived; `runbook plan archive-repos` enforces it",
  "#   ignore     — not reconciled",
  "#   unassigned — quarantined by the nightly sweep; triage me",
  "repos:",
].join("\n");

export function registryEntryLine(e: RepoEntry): string {
  return `  - { name: ${e.name}, disposition: ${e.disposition}${e.note ? `, note: "${e.note.replace(/"/g, "'")}"` : ""} }`;
}

/** Append an entry (create the file if needed); idempotent per repo name. */
export function appendToRegistry(current: string | undefined, entry: RepoEntry): string {
  const line = registryEntryLine(entry);
  if (!current) return `${REGISTRY_HEADER}\n${line}\n`;
  if (new RegExp(`name:\\s*${entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,}\\n]`).test(current)) return current;
  return current.replace(/^repos:$/m, `repos:\n${line}`);
}

/** The joined all-repos view: observed GitHub state x manifest/registry claims.
 *  Feeds CLI `repos` and the MCP list_repos tool. */
export interface RepoRow extends RepoFacts {
  claim: string; // "venture:<name>" | "registry:<disposition>" | "UNMANIFESTED"
}

export async function repoInventory(): Promise<
  | { ok: true; rows: RepoRow[]; claimedElsewhere: { venture: string; fullName: string; exists: boolean; archived?: boolean }[] }
  | { ok: false; reason: string }
> {
  const observed = await listRepos();
  if (!observed.ok) return { ok: false, reason: observed.reason };
  const loaded = loadVenturesWithFiles();
  const registry = loadRepoRegistry();
  const claims = new Map(claimedRepos(loaded).map((c) => [c.fullName.toLowerCase(), c.venture]));
  const reg = new Map(registry.repos.map((r) => [r.name.toLowerCase(), r.disposition]));

  const rows: RepoRow[] = observed.repos.map((r) => {
    const key = r.fullName.toLowerCase();
    const claim = claims.has(key)
      ? `venture:${claims.get(key)}`
      : reg.has(key)
        ? `registry:${reg.get(key)}`
        : "UNMANIFESTED";
    return { ...r, claim };
  });

  // Claims pointing outside the owned-repo sweep (org repos) or at nothing
  const observedKeys = new Set(rows.map((r) => r.fullName.toLowerCase()));
  const claimedElsewhere: { venture: string; fullName: string; exists: boolean; archived?: boolean }[] = [];
  for (const c of claimedRepos(loaded)) {
    if (observedKeys.has(c.fullName.toLowerCase())) continue;
    const st = await repoState(c.fullName);
    claimedElsewhere.push({
      venture: c.venture,
      fullName: c.fullName,
      exists: "exists" in st && st.exists,
      archived: "exists" in st && st.exists ? st.archived : undefined,
    });
  }
  return { ok: true, rows, claimedElsewhere };
}
