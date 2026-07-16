import type { AdapterResult, DomainReader } from "./types.js";

/**
 * Vercel reader. Requires VERCEL_TOKEN (read-only scope — I2: scheduled jobs
 * never hold write credentials). Endpoint paths are training-vintage — verify
 * against current API docs on first authenticated run (M1 threshold item).
 */
export class VercelReader implements DomainReader {
  readonly name = "vercel";
  constructor(private token = process.env.VERCEL_TOKEN) {}

  covers(_domain?: string): boolean { return Boolean(this.token); }

  async read(domain: string): Promise<AdapterResult> {
    if (!this.token) return { ok: false, degraded: true, reason: "VERCEL_TOKEN not set" };
    try {
      const res = await fetch(`https://api.vercel.com/v5/domains/${domain}`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return { ok: false, degraded: true, reason: `HTTP ${res.status}` };
      const j = (await res.json()) as { domain?: { expiresAt?: number; nameservers?: string[] } };
      const d = j.domain ?? {};
      return {
        ok: true,
        facts: {
          domain,
          expires: d.expiresAt ? new Date(d.expiresAt).toISOString().slice(0, 10) : undefined,
          nameservers: d.nameservers,
          source: "vercel",
          observedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { ok: false, degraded: true, reason: `fetch failed: ${(e as Error).message}` };
    }
  }

  /** Every domain in the account — the I1 unmanifested-asset audit compares
   *  this against the union of all venture manifests. */
  async listDomains(): Promise<{ ok: true; domains: string[] } | { ok: false; reason: string }> {
    if (!this.token) return { ok: false, reason: "VERCEL_TOKEN not set" };
    try {
      const domains: string[] = [];
      let until: number | undefined;
      for (let page = 0; page < 10; page++) {
        const url = new URL("https://api.vercel.com/v5/domains");
        url.searchParams.set("limit", "100");
        if (until) url.searchParams.set("until", String(until));
        const res = await fetch(url, { headers: { authorization: `Bearer ${this.token}` } });
        if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
        const j = (await res.json()) as { domains?: { name: string }[]; pagination?: { next?: number | null } };
        for (const d of j.domains ?? []) domains.push(d.name);
        if (!j.pagination?.next) break;
        until = j.pagination.next;
      }
      return { ok: true, domains };
    } catch (e) {
      return { ok: false, reason: `fetch failed: ${(e as Error).message}` };
    }
  }
}
