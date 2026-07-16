/**
 * Format-preserving text edits on venture manifests. js-yaml round-trips
 * destroy comments and dated block notes — the manifests' institutional
 * memory — so drift auto-PRs and runbook plans edit the YAML as text,
 * handling both entry styles that appear in ventures/:
 *   flow:   - { name: x.com, registrar: vercel, role: redirect, renews: 2027-01-01 }
 *   block:  - name: x.com
 *             registrar: vercel
 *             note: >-
 *               multi-line...
 */

/** One manifest mutation, carried by a Drift fix or a runbook plan.
 *  `mutate` receives the current file text (undefined = file does not exist). */
export interface ManifestEdit {
  file: string; // repo-relative, forward slashes
  description: string;
  mutate: (current: string | undefined) => string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Set (replace or insert) a scalar field on the domain entry named `domain`. */
export function setDomainField(text: string, domain: string, field: string, value: string): string {
  const lines = text.split("\n");

  // Flow style: the whole entry lives on one `- { ... }` line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^\s*-\s*\{/.test(line)) continue;
    if (!new RegExp(`name:\\s*${escapeRe(domain)}\\s*[,}]`).test(line)) continue;
    const fieldRe = new RegExp(`(\\b${escapeRe(field)}:\\s*)[^,}]*`);
    lines[i] = fieldRe.test(line)
      ? line.replace(fieldRe, `$1${value}`)
      : line.replace(/\s*\}\s*$/, `, ${field}: ${value} }`);
    return lines.join("\n");
  }

  // Block style: entry runs from `- name: domain` until the next line at or
  // left of the dash indent (next list item, or a top-level key).
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(new RegExp(`^(\\s*)-\\s+name:\\s*${escapeRe(domain)}\\s*$`));
    if (!m) continue;
    const dashIndent = m[1]!.length;
    const fieldIndent = " ".repeat(dashIndent + 2); // fields align under the `- `
    let end = i + 1;
    while (end < lines.length) {
      const l = lines[end]!;
      if (l.trim() !== "" && (l.match(/^\s*/)![0]?.length ?? 0) <= dashIndent) break;
      end++;
    }
    const fieldLineRe = new RegExp(`^${fieldIndent}${escapeRe(field)}:`);
    for (let j = i + 1; j < end; j++) {
      if (fieldLineRe.test(lines[j]!)) {
        lines[j] = `${fieldIndent}${field}: ${value}`;
        return lines.join("\n");
      }
    }
    lines.splice(i + 1, 0, `${fieldIndent}${field}: ${value}`);
    return lines.join("\n");
  }

  throw new Error(`domain ${domain} not found in manifest text`);
}

/** Set a top-level scalar field (e.g. status). Inserts after name: if absent. */
export function setTopLevelField(text: string, field: string, value: string): string {
  const re = new RegExp(`^${escapeRe(field)}:.*$`, "m"); // top-level only: nested keys are indented
  if (re.test(text)) return text.replace(re, `${field}: ${value}`);
  return text.replace(/^(name:.*)$/m, `$1\n${field}: ${value}`);
}

/** Flip every domain role in the file (park/sunset set all roles at once). */
export function setAllRoles(text: string, role: "canonical" | "redirect" | "parked"): string {
  return text.replace(/(\brole:\s*)(canonical|redirect|parked)\b/g, `$1${role}`);
}
