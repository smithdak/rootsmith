import type { DomainEntry } from "../manifest.js";
import type { DomainFacts } from "../ingest/types.js";
import type { ManifestEdit } from "../manifest-edit.js";

/**
 * Two-tier drift (I5).
 *  reality-authoritative  -> auto-PR fixes the MANIFEST (expiry, registrar-of-record, unmanifested assets)
 *  manifest-authoritative -> issue proposes fixing the WORLD (managed DNS, redirect targets, repo archived-status)
 */
export type DriftTier = "reality-authoritative" | "manifest-authoritative";

export interface Drift {
  fingerprint: string;       // asset + type — dedup key for issues (never duplicate, always update)
  tier: DriftTier;
  asset: string;
  kind: string;
  detail: string;
  /** Present when the drift can be fixed by editing a manifest: the report
   *  path turns it into an auto-PR instead of an issue (I5, reality tier). */
  fix?: ManifestEdit;
}

export function diffDomain(venture: string, declared: DomainEntry, observed: DomainFacts | undefined): Drift[] {
  const out: Drift[] = [];
  if (!observed) return out;

  if (observed.expires && declared.renews && observed.expires !== declared.renews) {
    out.push({
      fingerprint: `${declared.name}:renews-mismatch`,
      tier: "reality-authoritative",
      asset: declared.name,
      kind: "renews-mismatch",
      detail: `manifest says ${declared.renews}, ${observed.source} says ${observed.expires} — auto-PR the manifest`,
    });
  }
  if (observed.expires && !declared.renews) {
    out.push({
      fingerprint: `${declared.name}:renews-missing`,
      tier: "reality-authoritative",
      asset: declared.name,
      kind: "renews-missing",
      detail: `observed expiry ${observed.expires} not recorded — auto-PR the manifest`,
    });
  }
  return out;
}

export function renewalAudit(venture: string, d: DomainEntry, withinDays: number, today = new Date()): Drift | undefined {
  if (!d.renews) return undefined;
  const days = Math.floor((new Date(d.renews).getTime() - today.getTime()) / 86_400_000);
  if (days > withinDays) return undefined;
  return {
    fingerprint: `${d.name}:renewal-window`,
    tier: "reality-authoritative",
    asset: d.name,
    kind: days < 0 ? "EXPIRED" : "renewal-window",
    detail: `${d.name} (${venture}) ${days < 0 ? `expired ${-days}d ago` : `renews in ${days}d`} — ${d.renews} [basis: ${d.basis ?? "?"}]`,
  };
}
