import type { AdapterResult, DomainReader } from "./types.js";

/**
 * RDAP reader — the universal degraded mode (I6).
 * Ground truth as of 2026-07-15:
 *  - .io is ABSENT from the IANA RDAP bootstrap: no coverage, ever, until
 *    the registry deploys it. covers() excludes it.
 *  - .ai has RDAP but rate-limits aggressively (persistent 429s). Backoff
 *    + accept-stale is mandatory; nightly cadence with jitter is fine.
 */
const NO_RDAP_TLDS = new Set(["io"]); // verified against IANA bootstrap 2026-07-15

export class RdapReader implements DomainReader {
  readonly name = "rdap";

  covers(domain: string): boolean {
    const tld = domain.split(".").pop() ?? "";
    return !NO_RDAP_TLDS.has(tld);
  }

  async read(domain: string): Promise<AdapterResult> {
    if (!this.covers(domain)) {
      return { ok: false, degraded: true, reason: `no RDAP service for .${domain.split(".").pop()}` };
    }
    const delays = [0, 5000, 15000]; // .ai needs patience
    for (const [attempt, delay] of delays.entries()) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await fetch(`https://rdap.org/domain/${domain}`, {
          headers: { "user-agent": "rootsmith/0.1" },
          redirect: "follow",
        });
        if (res.status === 429) continue;
        if (res.status === 404) {
          return { ok: false, degraded: true, reason: "NOT FOUND at registry — domain may be unregistered" };
        }
        if (!res.ok) return { ok: false, degraded: true, reason: `HTTP ${res.status}` };
        const j = (await res.json()) as Record<string, unknown>;
        return { ok: true, facts: parseRdap(domain, j) };
      } catch (e) {
        if (attempt === delays.length - 1) {
          return { ok: false, degraded: true, reason: `fetch failed: ${(e as Error).message}` };
        }
      }
    }
    return { ok: false, degraded: true, reason: "rate-limited after retries (expected for .ai; retry next run)" };
  }
}

function parseRdap(domain: string, j: Record<string, unknown>) {
  let registrar: string | undefined;
  for (const ent of (j.entities as { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[]) ?? []) {
    if (ent.roles?.includes("registrar")) {
      for (const item of ent.vcardArray?.[1] ?? []) {
        if (item[0] === "fn") registrar = item[3];
      }
    }
  }
  let expires: string | undefined;
  for (const ev of (j.events as { eventAction: string; eventDate: string }[]) ?? []) {
    if (ev.eventAction === "expiration") expires = ev.eventDate.slice(0, 10);
  }
  const locks = ((j.status as string[]) ?? []).filter((s) => s.includes("prohibited"));
  return { domain, registrar, expires, locks, source: "rdap" as const, observedAt: new Date().toISOString() };
}
