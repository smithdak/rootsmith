/**
 * Certificate-transparency lookup via crt.sh — surfaces forgotten subdomains,
 * which is where dangling-CNAME takeovers live. Read-only, unauthenticated.
 * Wired into the M2 audit pass, not the per-domain fact model.
 */
export async function subdomainsFromCT(domain: string): Promise<string[]> {
  const res = await fetch(`https://crt.sh/?q=%25.${domain}&output=json`);
  if (!res.ok) return [];
  const rows = (await res.json()) as { name_value: string }[];
  const names = new Set<string>();
  for (const r of rows) for (const n of r.name_value.split("\n")) {
    if (n.endsWith(domain) && !n.startsWith("*")) names.add(n.toLowerCase());
  }
  return [...names].sort();
}
