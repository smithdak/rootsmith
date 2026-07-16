import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

/** Expected record in a dns_policy: managed zone (I5: manifest is truth there). */
export interface DnsRecord {
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS";
  name: string; // "@" for apex, otherwise relative label ("www")
  value: string;
  priority?: number;
}

export interface DomainEntry {
  name: string;
  registrar: "vercel" | "godaddy" | "squarespace" | "unknown";
  role: "canonical" | "redirect" | "parked";
  renews?: string;
  basis?: "rdap" | "dashboard" | "manual";
  verify_by?: string;
  note?: string;
  dns?: DnsRecord[];
}

export interface Venture {
  name: string;
  status: "active" | "parked" | "sunsetting" | "archived";
  domains: DomainEntry[];
  repo?: string;
  deploy?: { provider: "vercel"; project: string };
  email?: { provider?: string; routes?: string[] };
  social?: Record<string, string>;
  dns_policy?: "managed" | "observed";
  notes?: string;
}

/** A venture plus its repo-relative manifest path — drift auto-PRs and runbook
 *  plans edit the file, so the mapping travels with the parse. */
export interface LoadedVenture {
  file: string; // e.g. "ventures/acme.yaml" (forward slashes — git paths)
  venture: Venture;
}

const schema = JSON.parse(readFileSync(new URL("../schema/venture.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<Venture>(schema);

const DEFAULT_DIR = fileURLToPath(new URL("../ventures", import.meta.url));

/** Strict on our own surface: unknown fields FAIL, in CI and everywhere else. */
export function loadVenturesWithFiles(dir = DEFAULT_DIR): LoadedVenture[] {
  const out: LoadedVenture[] = [];
  const errors: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    // JSON_SCHEMA: unquoted ISO dates remain strings (core schema coerces them to Date, which the strict schema rightly rejects)
    const doc = yaml.load(readFileSync(join(dir, f), "utf8"), { schema: yaml.JSON_SCHEMA });
    if (validate(doc)) out.push({ file: `ventures/${f}`, venture: doc });
    else errors.push(`${f}: ${ajv.errorsText(validate.errors)}`);
  }
  if (errors.length) throw new Error(`manifest validation failed\n  ${errors.join("\n  ")}`);
  return out;
}

export function loadVentures(dir = DEFAULT_DIR): Venture[] {
  return loadVenturesWithFiles(dir).map((x) => x.venture);
}

export function allDomains(vs: Venture[]): { venture: string; d: DomainEntry }[] {
  return vs.flatMap((v) => v.domains.map((d) => ({ venture: v.name, d })));
}
