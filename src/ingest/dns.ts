import type { AdapterResult, DomainReader } from "./types.js";

/**
 * DNS reader — actual-state truth, provider-agnostic (never a provider API).
 * Uses DNS-over-HTTPS so it runs identically in sandboxes, CI, and laptops;
 * swap to direct authoritative-NS queries (node:dns with resolver pinning)
 * when running somewhere with unrestricted UDP/53.
 */
/** Single-record DoH query for the audits (managed-zone mismatch, dangling
 *  CNAMEs). status 3 = NXDOMAIN — the signal both audits pivot on. */
export async function resolveDns(
  name: string,
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS"
): Promise<{ status: number; records: string[] } | { error: string }> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
    if (!res.ok) return { error: `DoH HTTP ${res.status}` };
    const j = (await res.json()) as { Status: number; Answer?: { data: string }[] };
    return { status: j.Status, records: (j.Answer ?? []).map((a) => a.data) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export class DnsReader implements DomainReader {
  readonly name = "dns";
  covers(): boolean { return true; }

  async read(domain: string): Promise<AdapterResult> {
    try {
      const res = await fetch(`https://dns.google/resolve?name=${domain}&type=NS`);
      if (!res.ok) return { ok: false, degraded: true, reason: `DoH HTTP ${res.status}` };
      const j = (await res.json()) as { Status: number; Answer?: { data: string }[] };
      if (j.Status === 3) {
        return { ok: false, degraded: true, reason: "NXDOMAIN — no delegation; domain may be lapsed" };
      }
      return {
        ok: true,
        facts: {
          domain,
          nameservers: (j.Answer ?? []).map((a) => a.data.replace(/\.$/, "")),
          source: "dns",
          observedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { ok: false, degraded: true, reason: `DoH failed: ${(e as Error).message}` };
    }
  }
}
