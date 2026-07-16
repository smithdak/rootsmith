import type { PlanStep, RunbookOutput, RunbookParams } from "./types.js";

/**
 * provision — `venture new <name>` (M5), the compounding payoff: domain,
 * repo, deploy, manifest in one gated flow. The new manifest rides in the
 * plan PR; `renews` is left for the first nightly ingest to auto-PR in
 * (reality-authoritative, I5), which also proves the loop end-to-end.
 */
export function planProvision(name: string, p: RunbookParams): RunbookOutput {
  if (!p.domain) throw new Error("provision requires --domain <fqdn>");
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`venture name must match ^[a-z0-9-]+$ (got ${name})`);
  const project = p.project ?? name;
  const repoName = p.repo ?? name;
  const today = new Date().toISOString().slice(0, 10);
  const verifyBy = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const steps: PlanStep[] = [
    {
      id: 1,
      provider: "vercel",
      description: `register ${p.domain} at Vercel — SPENDS MONEY; endpoint and pricing are training-vintage (SPEC appendix flag): verify price in the dashboard before merging`,
      call: { method: "POST", url: "https://api.vercel.com/v4/domains/buy", body: { name: p.domain }, tokenEnv: "VERCEL_TOKEN" },
      expect: [200, 201],
      destructive: true,
    },
    {
      id: 2,
      provider: "github",
      description: `create private repo ${repoName} under the token's user account`,
      call: { method: "POST", url: "https://api.github.com/user/repos", body: { name: repoName, private: true, auto_init: true }, tokenEnv: "GITHUB_TOKEN" },
      expect: [201],
    },
    {
      id: 3,
      provider: "vercel",
      description: `create Vercel project ${project}`,
      call: { method: "POST", url: "https://api.vercel.com/v10/projects", body: { name: project }, tokenEnv: "VERCEL_TOKEN" },
      expect: [200, 201],
    },
    {
      id: 4,
      provider: "vercel",
      description: `attach ${p.domain} to project ${project}`,
      call: { method: "POST", url: `https://api.vercel.com/v10/projects/${project}/domains`, body: { name: p.domain }, tokenEnv: "VERCEL_TOKEN" },
      expect: [200],
    },
    {
      id: 5,
      provider: "manual",
      description: `link the GitHub repo to the Vercel project in the dashboard (repo owner is unknowable at plan time), then verify apex + www DNS auto-config`,
    },
    {
      id: 6,
      provider: "manual",
      description: `email routing for ${p.domain} (O3 is still open) — when chosen, record it in the manifest email: field`,
    },
  ];

  const manifest = [
    `name: ${name}`,
    `status: active`,
    `domains:`,
    `  - name: ${p.domain}`,
    `    registrar: vercel`,
    `    role: canonical`,
    `    basis: manual`,
    `    verify_by: ${verifyBy}`,
    `    note: provisioned ${today} via runbook; renews arrives by nightly-ingest auto-PR`,
    `repo: github.com/<owner>/${repoName}  # fill owner after step 2 applies`,
    `deploy: { provider: vercel, project: ${project} }`,
    `dns_policy: observed`,
    ``,
  ].join("\n");

  return {
    steps,
    edits: [
      {
        file: `ventures/${name}.yaml`,
        description: `create ventures/${name}.yaml`,
        mutate: (cur) => {
          if (cur) throw new Error(`ventures/${name}.yaml already exists — provision is for new ventures`);
          return manifest;
        },
      },
    ],
    notes: [
      "Step 1 spends money and cannot be un-spent — the required-reviewer gate on the apply environment is there for exactly this merge.",
      "The manifest lands with renews unset on purpose: the first nightly run auto-PRs the registry value in, proving reconciliation on day one.",
    ],
  };
}
