import { loadVenturesWithFiles, type DomainEntry } from "../manifest.js";
import { diffDomain, renewalAudit, type Drift } from "./diff.js";
import { RdapReader } from "../ingest/rdap.js";
import { DnsReader, resolveDns } from "../ingest/dns.js";
import { VercelReader } from "../ingest/vercel.js";
import { certExpiry } from "../ingest/cert.js";
import { subdomainsFromCT } from "../ingest/crtsh.js";
import { setDomainField, type ManifestEdit } from "../manifest-edit.js";
import type { DomainFacts } from "../ingest/types.js";
import { listRepos, repoState } from "../ingest/github.js";
import { loadRepoRegistry, claimedRepos, appendToRegistry, REPOS_FILE } from "../repos.js";

/**
 * The nightly audit pass (spec §4), shared by CLI `drift`, the MCP
 * `list_drift` tool, and the nightly workflow. Every source degrades
 * instead of throwing (I6); everything found is fingerprinted asset:kind.
 */
export interface CollectOptions {
  deep?: boolean;    // adds the crt.sh dangling-CNAME sweep (slow, CI-oriented)
  within?: number;   // renewal window in days
  dir?: string;      // ventures dir override (tests)
  log?: (s: string) => void;
}

export interface Collected {
  drifts: Drift[];
  degraded: string[]; // sources that couldn't attest — logged, never fatal
}

const CERT_WARN_DAYS = 14;

export async function collectDrift(o: CollectOptions = {}): Promise<Collected> {
  const within = o.within ?? 90;
  const loaded = o.dir ? loadVenturesWithFiles(o.dir) : loadVenturesWithFiles();
  const rdap = new RdapReader();
  const dns = new DnsReader();
  const vercel = new VercelReader();
  const drifts: Drift[] = [];
  const degraded: string[] = [];

  const jobs = loaded.flatMap(({ file, venture: v }) =>
    v.domains.map(async (d): Promise<Drift[]> => {
      const out: Drift[] = [];
      const [r, n] = await Promise.all([
        rdap.covers(d.name)
          ? rdap.read(d.name)
          : Promise.resolve({ ok: false as const, degraded: true as const, reason: "no RDAP coverage" }),
        dns.read(d.name),
      ]);

      // Registry facts: RDAP is truth; Vercel joins as fallback when RDAP degrades (.io, .ai 429s)
      let facts: DomainFacts | undefined = r.ok ? r.facts : undefined;
      if (!facts && vercel.covers(d.name)) {
        const vr = await vercel.read(d.name);
        if (vr.ok) facts = vr.facts;
      }
      if (!r.ok) degraded.push(`${d.name}: rdap degraded — ${r.reason}`);

      for (const drift of diffDomain(v.name, d, facts)) {
        drift.fix = renewsFix(file, d, drift, facts);
        out.push(drift);
      }

      const ren = renewalAudit(v.name, d, within);
      if (ren) out.push(ren);

      if (!r.ok && r.reason.includes("unregistered")) {
        out.push({
          fingerprint: `${d.name}:possibly-unregistered`,
          tier: "reality-authoritative",
          asset: d.name,
          kind: "possibly-unregistered",
          detail: `RDAP 404 at a working registry endpoint — ${d.name} may be unregistered; locate the holding account, re-register or archive`,
        });
      }
      if (!n.ok && n.reason.includes("NXDOMAIN")) {
        out.push({
          fingerprint: `${d.name}:undelegated`,
          tier: "manifest-authoritative",
          asset: d.name,
          kind: "undelegated",
          detail: `no NS delegation at the registry — restore delegation or set the venture entry to archived (fix the world, I5)`,
        });
      }

      // Managed-zone DNS audit: only where the manifest claims DNS authority (I4/I5)
      if (v.dns_policy === "managed" && d.dns?.length && n.ok) {
        for (const rec of d.dns) {
          const fqdn = rec.name === "@" ? d.name : `${rec.name}.${d.name}`;
          const ans = await resolveDns(fqdn, rec.type);
          const got = "records" in ans ? ans.records : [];
          const want = rec.value.replace(/\.$/, "").toLowerCase();
          if (!got.some((g) => g.replace(/\.$/, "").toLowerCase().includes(want))) {
            out.push({
              fingerprint: `${fqdn}:${rec.type}:dns-mismatch`,
              tier: "manifest-authoritative",
              asset: fqdn,
              kind: "dns-mismatch",
              detail: `managed zone: expected ${rec.type} ${want}, observed [${got.join(", ") || "none"}] — fix the world (I5)`,
            });
          }
        }
      }

      // Cert expiry: what's on the wire for live canonical domains
      if (v.status === "active" && d.role === "canonical" && n.ok) {
        const c = await certExpiry(d.name);
        if (c.ok && c.daysLeft <= CERT_WARN_DAYS) {
          out.push({
            fingerprint: `${d.name}:cert-expiry`,
            tier: "manifest-authoritative",
            asset: d.name,
            kind: c.daysLeft < 0 ? "cert-expired" : "cert-expiry",
            detail: `TLS certificate ${c.daysLeft < 0 ? `EXPIRED ${-c.daysLeft}d ago` : `expires in ${c.daysLeft}d`} (${c.validTo}) — fix the world`,
          });
        } else if (!c.ok) {
          degraded.push(`${d.name}: cert check degraded — ${c.reason}`);
        }
      }

      // Dangling-CNAME sweep (deep): CT-known subdomains whose CNAME target is
      // NXDOMAIN — the subdomain-takeover vector parked zones breed (spec §4)
      if (o.deep && n.ok) {
        const subs = (await subdomainsFromCT(d.name)).filter((s) => s !== d.name).slice(0, 30);
        for (const sub of subs) {
          const cn = await resolveDns(sub, "CNAME");
          if (!("records" in cn) || !cn.records.length) continue;
          const target = cn.records[0]!.replace(/\.$/, "");
          const ta = await resolveDns(target, "A");
          if ("status" in ta && ta.status === 3) {
            out.push({
              fingerprint: `${sub}:dangling-cname`,
              tier: "manifest-authoritative",
              asset: sub,
              kind: "dangling-cname",
              detail: `CNAME -> ${target}, which is NXDOMAIN — subdomain-takeover vector; delete the record (fix the world)`,
            });
          }
        }
      }

      return out;
    })
  );
  for (const set of await Promise.all(jobs)) drifts.push(...set);

  // I1: assets observed at the provider but absent from every manifest
  const listed = await vercel.listDomains();
  if (listed.ok) {
    const known = new Set(loaded.flatMap((l) => l.venture.domains.map((d) => d.name)));
    for (const name of listed.domains) {
      if (known.has(name)) continue;
      drifts.push({
        fingerprint: `${name}:unmanifested`,
        tier: "reality-authoritative",
        asset: name,
        kind: "unmanifested-asset",
        detail: `observed in the Vercel account but absent from every manifest (I1) — auto-PR quarantines it in ventures/unassigned.yaml pending assignment`,
        fix: unassignedFix(name),
      });
    }
  } else {
    degraded.push(`vercel domain list — ${listed.reason} (unmanifested-asset audit skipped)`);
  }

  // ---- GitHub repo audits: I1 sweep + archived-status reconciliation (I5) ----
  const registry = loadRepoRegistry();
  const claims = claimedRepos(loaded);

  // I1 says exactly one manifest: duplicate claims are drift in the map itself
  const claimCount = new Map<string, string[]>();
  for (const c of claims) {
    const key = c.fullName.toLowerCase();
    claimCount.set(key, [...(claimCount.get(key) ?? []), c.venture]);
  }
  for (const r of registry.repos) {
    const key = r.name.toLowerCase();
    if (claimCount.has(key)) claimCount.set(key, [...claimCount.get(key)!, "repos.yaml"]);
  }
  for (const [key, owners] of claimCount) {
    if (owners.length > 1) {
      drifts.push({
        fingerprint: `${key}:duplicate-claim`,
        tier: "manifest-authoritative",
        asset: key,
        kind: "repo-duplicate-claim",
        detail: `claimed by ${owners.join(" AND ")} — I1 requires exactly one owner; remove the extras`,
      });
    }
  }

  const ghList = await listRepos();
  if (!ghList.ok) {
    degraded.push(`github repo list — ${ghList.reason} (repo audits skipped)`);
    return { drifts, degraded };
  }
  const observed = new Map(ghList.repos.map((r) => [r.fullName.toLowerCase(), r]));

  // Venture-claimed repos: existence + archived-status vs venture status
  for (const c of claims) {
    const looked = observed.get(c.fullName.toLowerCase()) ?? (await lookupRepo(c.fullName));
    const v = loaded.find((l) => l.venture.name === c.venture)!.venture;
    if (looked === "degraded") {
      degraded.push(`${c.fullName}: repo state unreadable — audit skipped`);
      continue;
    }
    const o = looked;
    if (!o) {
      drifts.push({
        fingerprint: `${c.fullName}:repo-gone`,
        tier: "reality-authoritative",
        asset: c.fullName,
        kind: "repo-gone",
        detail: `venture ${c.venture} claims ${c.fullName} but GitHub 404s — restore the repo or fix the manifest`,
      });
      continue;
    }
    if (v.status === "active" && o.archived) {
      drifts.push({
        fingerprint: `${c.fullName}:repo-archived-mismatch`,
        tier: "manifest-authoritative",
        asset: c.fullName,
        kind: "repo-archived-mismatch",
        detail: `venture ${c.venture} is active but its repo is archived — unarchive it, or sunset the venture (fix the world, I5)`,
      });
    }
    if (v.status === "archived" && !o.archived) {
      drifts.push({
        fingerprint: `${c.fullName}:repo-unarchived-mismatch`,
        tier: "manifest-authoritative",
        asset: c.fullName,
        kind: "repo-unarchived-mismatch",
        detail: `venture ${c.venture} is archived but its repo is not — a sunset or archive-repos plan closes the gap (fix the world, I5)`,
      });
    }
  }

  // Registry dispositions are desired state — verify convergence
  for (const r of registry.repos) {
    if (r.disposition === "ignore") continue;
    const looked = observed.get(r.name.toLowerCase()) ?? (await lookupRepo(r.name));
    if (looked === "degraded") {
      degraded.push(`${r.name}: repo state unreadable — audit skipped`);
      continue;
    }
    const o = looked;
    if (!o) {
      drifts.push({
        fingerprint: `${r.name}:repo-gone`,
        tier: "reality-authoritative",
        asset: r.name,
        kind: "repo-gone",
        detail: `repos.yaml lists ${r.name} but GitHub 404s — remove the entry or restore the repo`,
      });
      continue;
    }
    if (r.disposition === "archive" && !o.archived) {
      drifts.push({
        fingerprint: `${r.name}:repo-archive-pending`,
        tier: "manifest-authoritative",
        asset: r.name,
        kind: "repo-archive-pending",
        detail: `disposition is archive but the repo is not archived — merge a \`runbook plan archive-repos\` PR (fix the world, I5)`,
      });
    }
    if (r.disposition === "keep" && o.archived) {
      drifts.push({
        fingerprint: `${r.name}:repo-keep-archived`,
        tier: "manifest-authoritative",
        asset: r.name,
        kind: "repo-keep-archived",
        detail: `disposition is keep but the repo is archived — unarchive it or flip the disposition`,
      });
    }
  }

  // I1 sweep: owned repos claimed by nothing get quarantined by auto-PR
  const spokenFor = new Set([...claims.map((c) => c.fullName.toLowerCase()), ...registry.repos.map((r) => r.name.toLowerCase())]);
  const today = new Date().toISOString().slice(0, 10);
  for (const repo of ghList.repos) {
    if (spokenFor.has(repo.fullName.toLowerCase())) continue;
    drifts.push({
      fingerprint: `${repo.fullName}:repo-unmanifested`,
      tier: "reality-authoritative",
      asset: repo.fullName,
      kind: "repo-unmanifested",
      detail: `owned repo with no venture claim and no registry entry (I1) — auto-PR quarantines it in ${REPOS_FILE}`,
      fix: {
        file: REPOS_FILE,
        description: `quarantine ${repo.fullName} in ${REPOS_FILE}`,
        mutate: (cur) =>
          appendToRegistry(cur, {
            name: repo.fullName,
            disposition: "unassigned",
            note: `observed ${today} (I1 sweep)${repo.fork ? "; fork" : ""}${repo.archived ? "; already archived" : ""}`,
          }),
      },
    });
  }

  return { drifts, degraded };
}

/** Individual lookup for claimed repos outside the owned sweep (org repos).
 *  undefined = confirmed 404; "degraded" = unreadable, never report as gone. */
async function lookupRepo(fullName: string): Promise<{ fullName: string; archived: boolean } | undefined | "degraded"> {
  const st = await repoState(fullName);
  if ("degraded" in st) return "degraded";
  if (st.exists) return { fullName, archived: st.archived };
  return undefined;
}

/** Reality-authoritative renews drift carries its own manifest fix (I5). */
function renewsFix(file: string, d: DomainEntry, drift: Drift, facts: DomainFacts | undefined): ManifestEdit | undefined {
  if (!facts?.expires) return undefined;
  if (drift.kind !== "renews-mismatch" && drift.kind !== "renews-missing") return undefined;
  const expires = facts.expires;
  const basis = facts.source === "rdap" ? "rdap" : "dashboard";
  return {
    file,
    description: `set renews: ${expires} (basis: ${basis}) on ${d.name}`,
    mutate: (cur) => {
      if (!cur) throw new Error(`${file} not found at HEAD`);
      return setDomainField(setDomainField(cur, d.name, "renews", expires), d.name, "basis", basis);
    },
  };
}

/** I1 quarantine: unmanifested assets land in ventures/unassigned.yaml so the
 *  invariant (every asset in exactly one manifest) is restored by the PR merge;
 *  assigning it to a real venture is the operator's follow-up move. */
function unassignedFix(domain: string): ManifestEdit {
  const today = new Date().toISOString().slice(0, 10);
  const verifyBy = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const entry = `  - { name: ${domain}, registrar: vercel, role: parked, basis: manual, verify_by: ${verifyBy}, note: "observed at Vercel ${today}, unmanifested (I1) — move to its venture or archive" }`;
  return {
    file: "ventures/unassigned.yaml",
    description: `quarantine ${domain} in ventures/unassigned.yaml`,
    mutate: (cur) => {
      if (!cur) {
        return [
          "name: unassigned",
          "status: parked",
          "domains:",
          entry,
          "dns_policy: observed",
          "notes: >-",
          "  I1 quarantine pen, maintained by the nightly reconciler: assets observed",
          "  at a provider but absent from every venture manifest land here via",
          "  auto-PR. Entries should be moved to their real venture (or archived)",
          "  promptly — this file existing at all means the map disagreed with the",
          "  territory.",
          "",
        ].join("\n");
      }
      if (cur.includes(`name: ${domain},`) || cur.includes(`name: ${domain}\n`)) return cur;
      return cur.replace(/^domains:$/m, `domains:\n${entry}`);
    },
  };
}
