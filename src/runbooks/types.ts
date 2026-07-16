import type { ManifestEdit } from "../manifest-edit.js";

/**
 * A plan is the reviewable artifact (I3): every intended API call, verbatim,
 * committed as JSON in the plan PR. Merging the PR is the approval; the apply
 * workflow executes exactly what was reviewed — no re-planning at apply time.
 */
export type RunbookName = "park" | "provision" | "sunset" | "archive-repos";

export interface PlanStep {
  id: number;
  provider: "vercel" | "github" | "manual";
  description: string;
  /** Absent = manual step: executed by the operator, outside the write path (I7). */
  call?: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    url: string;
    body?: unknown;
    /** Which env var in the apply environment holds the write token (I2). */
    tokenEnv: "VERCEL_TOKEN" | "GITHUB_TOKEN";
  };
  /** Acceptable HTTP statuses; default = any 2xx. */
  expect?: number[];
  /** Irreversible or money-spending — rendered loudly in the plan PR. */
  destructive?: boolean;
}

export interface Plan {
  runbook: RunbookName;
  venture: string;
  created: string; // ISO date
  steps: PlanStep[];
  notes: string[];
}

/** What a generator produces: the world-mutation steps plus the manifest
 *  edits that ride in the same PR (map and territory change together). */
export interface RunbookOutput {
  steps: PlanStep[];
  edits: ManifestEdit[];
  notes: string[];
}

export interface RunbookParams {
  domain?: string;   // provision: the domain to register
  repo?: string;     // provision: repo name (created under the token's user)
  project?: string;  // provision: Vercel project name (default: venture name)
  release?: boolean; // sunset: let registrations lapse instead of parking them
}
