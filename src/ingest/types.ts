/**
 * The registrar seam (I6). Two real adapters exist — Vercel API and RDAP —
 * which is what makes this a seam and not speculation. RDAP is the universal
 * degraded mode: any adapter losing API access falls back to it, so the
 * nightly run degrades instead of breaking.
 *
 * Interface statement: given a domain name, return whatever facts this
 * source can attest, marked with provenance; return { degraded } — never
 * throw — when the source is unreachable, rate-limited, or lacks coverage.
 */
export interface DomainFacts {
  domain: string;
  registrar?: string;      // registrar of record, verbatim from source
  expires?: string;        // ISO date
  locks?: string[];        // EPP statuses containing "prohibited"
  nameservers?: string[];
  source: "vercel" | "rdap" | "dns" | "manual";
  observedAt: string;      // ISO timestamp
}

export type AdapterResult =
  | { ok: true; facts: DomainFacts }
  | { ok: false; degraded: true; reason: string };

export interface DomainReader {
  readonly name: string;
  /** true if this source can even attempt the domain (e.g. RDAP has no .io) */
  covers(domain: string): boolean;
  read(domain: string): Promise<AdapterResult>;
}
