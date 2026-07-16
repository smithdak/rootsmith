#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadVentures, allDomains } from "../manifest.js";
import { renewalAudit } from "../reconcile/diff.js";
import { collectDrift } from "../reconcile/collect.js";
import { openPlanPr } from "../runbooks/plan.js";

/**
 * rootsmith MCP server (M3). Read tools plus exactly ONE write-shaped tool,
 * open_runbook_plan, which opens a plan PR and nothing else (I3) — no tool
 * applies anything. stdout is the protocol channel; all logging goes to
 * stderr (collectDrift already does).
 */
const server = new McpServer({ name: "rootsmith", version: "0.1.0" });

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
});

server.registerTool(
  "list_ventures",
  { description: "All ventures with status and domains — the manifest view (system of record, I1)." },
  async () =>
    text(loadVentures().map((v) => ({ name: v.name, status: v.status, domains: v.domains.map((d) => d.name) })))
);

server.registerTool(
  "get_venture",
  { description: "Full manifest for one venture.", inputSchema: { name: z.string() } },
  async ({ name }) => {
    const v = loadVentures().find((x) => x.name === name);
    return v ? text(v) : text(`no venture named ${name}`);
  }
);

server.registerTool(
  "renewals_within",
  {
    description: "Domains renewing (or already expired) within N days, from the manifest. Also lists domains with unknown renewal dates.",
    inputSchema: { days: z.number() },
  },
  async ({ days }) => {
    const vs = loadVentures();
    const hits = allDomains(vs)
      .map(({ venture, d }) => renewalAudit(venture, d, days))
      .filter(Boolean);
    const unknown = allDomains(vs)
      .filter(({ d }) => !d.renews)
      .map(({ venture, d }) => `${d.name} (${venture}): renewal date UNKNOWN`);
    return text({ within_days: days, renewals: hits, unknown });
  }
);

server.registerTool(
  "list_repos",
  {
    description:
      "All owned GitHub repos joined against venture claims and repos.yaml dispositions: which venture owns each repo, which are registry-managed (keep/archive/ignore/unassigned), which are UNMANIFESTED (I1 drift). Needs a GitHub token.",
  },
  async () => {
    const { repoInventory } = await import("../repos.js");
    const inv = await repoInventory();
    return inv.ok
      ? text({ repos: inv.rows, claimedOutsideSweep: inv.claimedElsewhere })
      : text(`cannot list repos: ${inv.reason}`);
  }
);

server.registerTool(
  "list_drift",
  {
    description:
      "Live reconcile: manifest vs RDAP + DNS (+ Vercel when VERCEL_TOKEN is set), classified two-tier (I5) and fingerprinted. deep=true adds the crt.sh dangling-CNAME sweep (slow).",
    inputSchema: { deep: z.boolean().optional() },
  },
  async ({ deep }) => {
    const { drifts, degraded } = await collectDrift({ deep });
    return text({
      drifts: drifts.map(({ fix, ...d }) => ({ ...d, autofix: fix ? fix.description : undefined })),
      degraded,
    });
  }
);

server.registerTool(
  "open_runbook_plan",
  {
    description:
      "The ONLY write-shaped tool (I3): opens a runbook plan PR describing every intended API call. It never executes anything — merging the PR is the approval, and apply-on-merge is the only write path. params: provision needs domain (fqdn), optionally repo/project; sunset accepts release=true to plan letting registrations lapse; archive-repos is registry-scoped (venture ignored).",
    inputSchema: {
      runbook: z.enum(["park", "provision", "sunset", "archive-repos"]),
      venture: z.string().optional(),
      params: z
        .object({
          domain: z.string().optional(),
          repo: z.string().optional(),
          project: z.string().optional(),
          release: z.boolean().optional(),
        })
        .optional(),
    },
  },
  async ({ runbook, venture, params }) => {
    if (!venture && runbook !== "archive-repos") return text(`runbook ${runbook} requires a venture`);
    return text(await openPlanPr(runbook, venture ?? "repos", params ?? {}));
  }
);

await server.connect(new StdioServerTransport());
console.error("rootsmith MCP server listening on stdio");
