import { readFileSync } from "node:fs";
import type { Plan } from "./types.js";

/**
 * Execute a merged, reviewed plan file — the ONLY code path that mutates the
 * world (I3), run exclusively by apply-on-merge inside the `apply`
 * environment (I2). Fails loudly and stops on the first unexpected status:
 * a half-applied plan must look half-applied, and the nightly reconcile will
 * catch whatever state it left behind.
 */
export async function applyPlan(path: string): Promise<number> {
  let plan: Plan;
  try {
    plan = JSON.parse(readFileSync(path, "utf8")) as Plan;
  } catch (e) {
    console.error(`cannot read plan ${path}: ${(e as Error).message}`);
    return 1;
  }
  if (!plan.runbook || !plan.venture || !Array.isArray(plan.steps)) {
    console.error(`${path} is not a plan file (runbook/venture/steps missing)`);
    return 1;
  }

  console.log(`applying plan: ${plan.runbook} ${plan.venture} (created ${plan.created}, ${plan.steps.length} steps)`);
  const manual: string[] = [];

  for (const s of plan.steps) {
    if (!s.call) {
      manual.push(s.description);
      console.log(`  [${s.id}] MANUAL — ${s.description}`);
      continue;
    }
    const token = process.env[s.call.tokenEnv];
    if (!token) {
      console.error(`  [${s.id}] FAIL — ${s.call.tokenEnv} is not set (I2: write tokens exist only in the apply environment)`);
      return 1;
    }
    console.log(`  [${s.id}] ${s.call.method} ${s.call.url}${s.destructive ? "  (destructive)" : ""}`);
    let res: Response;
    try {
      res = await fetch(s.call.url, {
        method: s.call.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json, application/json",
          ...(s.call.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: s.call.body !== undefined ? JSON.stringify(s.call.body) : undefined,
      });
    } catch (e) {
      console.error(`      fetch failed: ${(e as Error).message} — stopping`);
      return 1;
    }
    const ok = s.expect ? s.expect.includes(res.status) : res.ok;
    if (!ok) {
      console.error(`      HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
      console.error(`      stopping — remaining steps NOT executed; nightly reconcile will surface the partial state`);
      return 1;
    }
    console.log(`      HTTP ${res.status} ok`);
  }

  if (manual.length) {
    console.log(`\nmanual steps remaining (operator, outside the write path — I7):`);
    for (const m of manual) console.log(`  - [ ] ${m}`);
  }
  console.log(`\nplan applied: ${plan.runbook} ${plan.venture}`);
  return 0;
}
