#!/usr/bin/env tsx
import { loadVentures, allDomains } from "./manifest.js";
import { renewalAudit } from "./reconcile/diff.js";
import { collectDrift } from "./reconcile/collect.js";
import { reportDrift } from "./reconcile/report.js";
import { RdapReader } from "./ingest/rdap.js";
import { DnsReader } from "./ingest/dns.js";
import { VercelReader } from "./ingest/vercel.js";

const [, , cmd = "status", ...rest] = process.argv;

function arg(flag: string, fallback: string): string {
  const i = rest.indexOf(flag);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : fallback;
}
const has = (flag: string) => rest.includes(flag);

switch (cmd) {
  case "validate": {
    const vs = loadVentures();
    const { loadRepoRegistry } = await import("./repos.js");
    const reg = loadRepoRegistry();
    console.log(`OK — ${vs.length} ventures, ${allDomains(vs).length} domains, ${reg.repos.length} registry repos, schema-valid.`);
    break;
  }

  case "repos": {
    // The all-repos view: observed GitHub state joined against venture claims
    // and repos.yaml dispositions. Read-only; drift does the signaling.
    const { repoInventory } = await import("./repos.js");
    const inv = await repoInventory();
    if (!inv.ok) {
      console.error(`cannot list repos: ${inv.reason}`);
      process.exit(2);
    }
    for (const r of inv.rows) {
      const flags = [r.archived ? "archived" : "", r.fork ? "fork" : "", r.private ? "private" : "public"].filter(Boolean).join(",");
      console.log(
        `${r.fullName.padEnd(42)} ${flags.padEnd(17)} push=${(r.pushedAt ?? "never").slice(0, 10)}  ${r.claim}`
      );
    }
    for (const c of inv.claimedElsewhere) {
      console.log(
        c.exists
          ? `${c.fullName.padEnd(42)} ${(c.archived ? "archived" : "").padEnd(17)} (org/external)   venture:${c.venture}`
          : `!! ${c.fullName} claimed by venture ${c.venture} but MISSING at GitHub`
      );
    }
    const counts = new Map<string, number>();
    for (const r of inv.rows) counts.set(r.claim.split(":")[0]!, (counts.get(r.claim.split(":")[0]!) ?? 0) + 1);
    console.log(
      `\n${inv.rows.length} owned repos — ${counts.get("venture") ?? 0} venture-claimed, ${counts.get("registry") ?? 0} in repos.yaml, ${counts.get("UNMANIFESTED") ?? 0} UNMANIFESTED${(counts.get("UNMANIFESTED") ?? 0) ? " (drift --report quarantines them)" : ""}`
    );
    break;
  }

  case "status": {
    // Manifest view by default; --live joins observed state (M1: the table
    // that must match the dashboards). RDAP + DNS need no tokens; Vercel
    // joins when VERCEL_TOKEN is set.
    const live = has("--live");
    const vs = loadVentures();
    const rdap = new RdapReader();
    const dns = new DnsReader();
    const vercel = new VercelReader();
    for (const v of vs) {
      console.log(`\n${v.name}  [${v.status}]  dns_policy=${v.dns_policy ?? "observed"}`);
      for (const d of v.domains) {
        const flag = d.note?.match(/URGENT|FINDING/)?.[0];
        console.log(
          `  ${d.name.padEnd(20)} ${d.registrar.padEnd(11)} ${d.role.padEnd(9)} renews=${(d.renews ?? "?").padEnd(10)} basis=${(d.basis ?? "?").padEnd(9)}${flag ? `  << ${flag}` : ""}`
        );
        if (!live) continue;
        const [r, n] = await Promise.all([
          rdap.covers(d.name)
            ? rdap.read(d.name)
            : Promise.resolve({ ok: false as const, degraded: true as const, reason: "no RDAP coverage" }),
          dns.read(d.name),
        ]);
        let observed = r.ok ? r.facts : undefined;
        let source = "rdap";
        if (!observed && vercel.covers(d.name)) {
          const vr = await vercel.read(d.name);
          if (vr.ok) { observed = vr.facts; source = "vercel"; }
        }
        const expiry = observed?.expires
          ? `${source} ${observed.expires}${d.renews ? (observed.expires === d.renews ? " =manifest" : ` != manifest ${d.renews} DRIFT`) : " (manifest unknown)"}`
          : `degraded (${r.ok ? "no expiry attested" : r.reason})`;
        const ns = n.ok ? (n.facts.nameservers ?? []).slice(0, 2).join(", ") || "none" : n.reason;
        console.log(`  ${" ".repeat(20)} observed: expiry ${expiry} | ns ${ns}`);
      }
    }
    break;
  }

  case "renewals": {
    const within = Number(arg("--within", "90"));
    const vs = loadVentures();
    const hits = allDomains(vs)
      .map(({ venture, d }) => renewalAudit(venture, d, within))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const unknowns = allDomains(vs).filter(({ d }) => !d.renews);
    if (!hits.length) console.log(`Nothing renews within ${within} days.`);
    for (const h of hits) console.log(`${h.kind === "EXPIRED" ? "!! " : "   "}${h.detail}`);
    for (const { venture, d } of unknowns)
      console.log(`?? ${d.name} (${venture}) renewal date UNKNOWN — ${d.note?.slice(0, 80) ?? "verify"}`);
    process.exit(hits.some((h) => h.kind === "EXPIRED") ? 1 : 0);
  }

  case "drift": {
    // Full audit pass (spec §4). --deep adds the crt.sh dangling-CNAME sweep;
    // --report files fingerprint-deduped issues + manifest auto-PRs (M2) and
    // exits 0 when reporting succeeded — the issues ARE the signal there.
    const { drifts, degraded } = await collectDrift({
      deep: has("--deep"),
      within: Number(arg("--within", "90")),
    });
    for (const d of drifts) console.log(`[${d.tier === "reality-authoritative" ? "reality" : "manifest"}] ${d.asset.padEnd(24)} ${d.kind.padEnd(22)} ${d.detail}`);
    if (!drifts.length) console.log("clean — the map matches the territory");
    for (const g of degraded) console.error(`  degraded: ${g}`);
    if (has("--report")) {
      await reportDrift(drifts);
      process.exit(0);
    }
    process.exit(drifts.length ? 1 : 0);
  }

  case "runbook": {
    const [sub, ...rbArgs] = rest;
    if (sub === "plan") {
      const [runbook, venture = runbook === "archive-repos" ? "repos" : undefined] = rbArgs;
      if (!runbook || !venture) {
        console.error("usage: rootsmith runbook plan <park|provision|sunset|archive-repos> [venture] [--domain D] [--repo R] [--project P] [--release]");
        process.exit(2);
      }
      const { openPlanPr } = await import("./runbooks/plan.js");
      try {
        const res = await openPlanPr(runbook, venture, {
          domain: rbArgs.includes("--domain") ? rbArgs[rbArgs.indexOf("--domain") + 1] : undefined,
          repo: rbArgs.includes("--repo") ? rbArgs[rbArgs.indexOf("--repo") + 1] : undefined,
          project: rbArgs.includes("--project") ? rbArgs[rbArgs.indexOf("--project") + 1] : undefined,
          release: rbArgs.includes("--release"),
        });
        console.log(`plan:   ${res.planPath}`);
        console.log(`branch: ${res.branch}`);
        console.log(res.message);
        process.exit(res.prUrl ? 0 : 1); // spec §3: exit 0 on PR open
      } catch (e) {
        console.error(`cannot plan: ${(e as Error).message}`);
        process.exit(1);
      }
    }
    if (sub === "apply") {
      const file = rbArgs[0];
      if (!file) { console.error("usage: rootsmith runbook apply <plan.json>"); process.exit(2); }
      const { applyPlan } = await import("./runbooks/apply.js");
      process.exit(await applyPlan(file));
    }
    console.error("usage: rootsmith runbook <plan|apply> ...");
    process.exit(2);
    break;
  }

  default:
    console.log(
      "usage: rootsmith <validate|status [--live]|repos|renewals [--within N]|drift [--deep] [--report]|runbook plan <rb> [venture]|runbook apply <file>>"
    );
}
