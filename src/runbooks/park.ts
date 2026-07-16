import type { Venture } from "../manifest.js";
import { setAllRoles, setTopLevelField } from "../manifest-edit.js";
import type { PlanStep, RunbookOutput } from "./types.js";

/**
 * park — the lowest-blast-radius runbook, built first to prove the gate
 * machinery (M4). Registration is always retained; parking only detaches
 * domains from their deploy and flips the manifest. Fully reversible.
 */
export function planPark(v: Venture, file: string): RunbookOutput {
  const steps: PlanStep[] = [];
  let id = 1;

  if (v.email?.routes?.length) {
    steps.push({
      id: id++,
      provider: "manual",
      description: `email routes exist (${v.email.routes.join(", ")}) — confirm mail is migrated or intentionally dropped BEFORE merging; email breaks silently`,
    });
  }

  if (v.deploy) {
    for (const d of v.domains) {
      steps.push({
        id: id++,
        provider: "vercel",
        description: `detach ${d.name} from Vercel project ${v.deploy.project} (registration retained; 404 tolerated = already detached)`,
        call: {
          method: "DELETE",
          url: `https://api.vercel.com/v9/projects/${v.deploy.project}/domains/${d.name}`,
          tokenEnv: "VERCEL_TOKEN",
        },
        expect: [200, 204, 404],
      });
    }
  } else {
    steps.push({
      id: id++,
      provider: "manual",
      description: "no deploy in the manifest — nothing to detach; parking is a manifest-only change",
    });
  }

  return {
    steps,
    edits: [
      {
        file,
        description: "status -> parked; every domain role -> parked",
        mutate: (cur) => {
          if (!cur) throw new Error(`${file} not found at HEAD`);
          return setAllRoles(setTopLevelField(cur, "status", "parked"), "parked");
        },
      },
    ],
    notes: [
      "Registrations are retained — renewal audits keep running against parked domains.",
      "Reversal: re-add domains to a project and flip the manifest back; no state is destroyed.",
    ],
  };
}
