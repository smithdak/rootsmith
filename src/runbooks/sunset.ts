import type { Venture } from "../manifest.js";
import { setAllRoles, setTopLevelField } from "../manifest-edit.js";
import type { PlanStep, RunbookOutput, RunbookParams } from "./types.js";

/**
 * sunset — the destructive runbook, built last by design (M6): it ships only
 * after months of gate trust. Registration deletion is NEVER automated; even
 * with --release the registrar-side lapse is a manual, human-executed step.
 */
export function planSunset(v: Venture, file: string, p: RunbookParams): RunbookOutput {
  const steps: PlanStep[] = [];
  let id = 1;

  steps.push({
    id: id++,
    provider: "manual",
    description: "export anything worth keeping (env vars, data, mail archives) BEFORE merging — after apply, the deploy is gone",
  });

  const repoMatch = v.repo?.match(/github\.com\/([^/]+\/[^/\s]+)/);
  if (repoMatch) {
    steps.push({
      id: id++,
      provider: "github",
      description: `archive repo ${repoMatch[1]} (reversible)`,
      call: { method: "PATCH", url: `https://api.github.com/repos/${repoMatch[1]}`, body: { archived: true }, tokenEnv: "GITHUB_TOKEN" },
      expect: [200],
    });
  } else if (v.repo) {
    steps.push({
      id: id++,
      provider: "manual",
      description: `manifest repo field (${v.repo}) is not a parseable github.com/<owner>/<name> — archive it by hand`,
    });
  }

  if (v.deploy) {
    for (const d of v.domains) {
      steps.push({
        id: id++,
        provider: "vercel",
        description: `detach ${d.name} from project ${v.deploy.project}`,
        call: {
          method: "DELETE",
          url: `https://api.vercel.com/v9/projects/${v.deploy.project}/domains/${d.name}`,
          tokenEnv: "VERCEL_TOKEN",
        },
        expect: [200, 204, 404],
      });
    }
    steps.push({
      id: id++,
      provider: "vercel",
      description: `DELETE Vercel project ${v.deploy.project} — destroys deployments, env vars, logs`,
      call: { method: "DELETE", url: `https://api.vercel.com/v9/projects/${v.deploy.project}`, tokenEnv: "VERCEL_TOKEN" },
      expect: [200, 204],
      destructive: true,
    });
  }

  steps.push({
    id: id++,
    provider: "manual",
    description: p.release
      ? "disable auto-renew on each domain in the registrar dashboard and let registrations lapse — registration deletion is never automated (blast radius, I7)"
      : "registrations are retained and parked; renewal audits keep running — drop domains explicitly at renewal time if unwanted (O4 pattern)",
  });

  return {
    steps,
    edits: [
      {
        file,
        description: "status -> archived; every domain role -> parked",
        mutate: (cur) => {
          if (!cur) throw new Error(`${file} not found at HEAD`);
          return setAllRoles(setTopLevelField(cur, "status", "archived"), "parked");
        },
      },
    ],
    notes: [
      "Destructive steps are marked; the apply environment's required reviewer is the second gate.",
      p.release
        ? "--release chosen: domains lapse by manual registrar action, not by API."
        : "Domains stay registered (default). Re-run with --release to plan a lapse.",
    ],
  };
}
