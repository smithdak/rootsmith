import { loadVenturesWithFiles } from "../manifest.js";
import { commitFilesToBranch, repoSlug, showFileAtHead } from "../git.js";
import { ghToken, ensureLabel, openOrUpdatePr } from "../gh.js";
import { planPark } from "./park.js";
import { planProvision } from "./provision.js";
import { planSunset } from "./sunset.js";
import { planArchiveRepos } from "./archive-repos.js";
import type { Plan, PlanStep, RunbookName, RunbookOutput, RunbookParams } from "./types.js";

export interface PlanPrResult {
  branch: string;
  planPath: string;
  commit?: string;
  prUrl?: string;
  message: string;
}

/**
 * The single entry point behind CLI `runbook plan` and the MCP
 * `open_runbook_plan` tool — and the only write-shaped thing either surface
 * can do (I3). It opens a PR; it never executes. The working tree is never
 * touched: plan + manifest edits are committed to the branch via plumbing.
 */
export async function openPlanPr(runbook: string, venture: string, params: RunbookParams = {}): Promise<PlanPrResult> {
  const loaded = loadVenturesWithFiles();
  const found = loaded.find((x) => x.venture.name === venture);

  let out: RunbookOutput;
  switch (runbook as RunbookName) {
    case "park":
      if (!found) throw new Error(`no venture named ${venture}`);
      out = planPark(found.venture, found.file);
      break;
    case "provision":
      if (found) throw new Error(`venture ${venture} already exists — provision is for new ventures`);
      out = planProvision(venture, params);
      break;
    case "sunset":
      if (!found) throw new Error(`no venture named ${venture}`);
      out = planSunset(found.venture, found.file, params);
      break;
    case "archive-repos":
      venture = "repos"; // registry-scoped, not venture-scoped
      out = await planArchiveRepos();
      break;
    default:
      throw new Error(`unknown runbook ${runbook} (park|provision|sunset|archive-repos)`);
  }

  const created = new Date().toISOString().slice(0, 10);
  const plan: Plan = { runbook: runbook as RunbookName, venture, created, steps: out.steps, notes: out.notes };
  const planPath = `plans/${venture}-${runbook}-${created}.json`;

  const files = [{ path: planPath, content: JSON.stringify(plan, null, 2) + "\n" }];
  for (const e of out.edits) {
    files.push({ path: e.file, content: e.mutate(showFileAtHead(e.file)) });
  }

  const branch = `runbook/${runbook}-${venture}`;
  const res = commitFilesToBranch({ branch, message: `runbook plan: ${runbook} ${venture}`, files });
  if (res.unchanged) return { branch, planPath, message: "plan produced no changes — nothing to open" };
  if (!res.pushed) {
    return {
      branch, planPath, commit: res.commit,
      message: `plan committed as ${res.commit.slice(0, 10)} but push failed (${res.pushError ?? "no origin remote?"}). Push it yourself: git push origin ${res.commit}:refs/heads/${branch}`,
    };
  }

  const repo = repoSlug();
  if (!repo || !ghToken()) {
    return {
      branch, planPath, commit: res.commit,
      message: `branch ${branch} pushed, but no GITHUB_TOKEN — open the PR by hand and label it runbook-plan`,
    };
  }

  await ensureLabel(repo, "runbook-plan", "0e8a16", "plan PR: merging is the approval; apply-on-merge executes it (I3)");
  const pr = await openOrUpdatePr(repo, {
    head: branch,
    title: `runbook plan: ${runbook} ${venture}`,
    body: renderPlan(plan, planPath, out),
    label: "runbook-plan",
  });
  return {
    branch, planPath, commit: res.commit, prUrl: pr.url,
    message: `${pr.created ? "opened" : "updated"} plan PR ${pr.url}`,
  };
}

/** The PR body IS the human-readable plan (I3): every intended call, verbatim. */
export function renderPlan(plan: Plan, planPath: string, out: RunbookOutput): string {
  const lines: string[] = [
    `## runbook plan: \`${plan.runbook} ${plan.venture}\``,
    ``,
    `Merging this PR **is** the approval (I3). \`apply-on-merge\` executes \`${planPath}\` — exactly the steps below, nothing re-planned — with the apply environment's write token (I2).`,
    ``,
    `| # | provider | intended action | |`,
    `|---|---|---|---|`,
  ];
  for (const s of plan.steps) {
    const what = s.call ? `\`${s.call.method} ${s.call.url}\`` : s.description;
    lines.push(`| ${s.id} | ${s.provider} | ${what} | ${s.destructive ? "**DESTRUCTIVE**" : ""} |`);
  }
  lines.push(``, `### Steps in full`, ``);
  for (const s of plan.steps) {
    lines.push(`**${s.id}. [${s.provider}]** ${s.description}`);
    if (s.call) {
      lines.push("```", `${s.call.method} ${s.call.url}`, ...(s.call.body ? [JSON.stringify(s.call.body)] : []), "```");
    }
    lines.push(``);
  }
  const manual = plan.steps.filter((s) => !s.call);
  if (manual.length) {
    lines.push(`### Manual steps (operator, outside the write path — I7)`, ``);
    for (const s of manual) lines.push(`- [ ] ${s.description}`);
    lines.push(``);
  }
  if (out.edits.length) {
    lines.push(`### Manifest changes riding in this PR`, ``);
    for (const e of out.edits) lines.push(`- \`${e.file}\` — ${e.description}`);
    lines.push(``);
  }
  if (plan.notes.length) {
    lines.push(`### Notes`, ``);
    for (const n of plan.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

/** Re-exported for the MCP tool's parameter docs. */
export type { PlanStep, RunbookParams };
