# Manifest reference

Two files kinds carry the desired state of the world: one YAML per venture under `ventures/`, and the repo registry `repos.yaml`. Everything the reconciler checks, every runbook plans, and every auto-PR edits traces back to these files (I1).

> [!WARNING]
> Both schemas are **strict**: `additionalProperties: false` at every level, so an unknown field fails `rsm validate` — locally and in [CI](../.github/workflows/ci.yml). Tolerance is reserved for *other people's* surfaces: unknown fields in provider API responses are ignored (I6).

## Venture manifests — `ventures/<name>.yaml`

The bundled example, verbatim ([`ventures/acme.yaml`](../ventures/acme.yaml)) — a real manifest looks the same with more rows and registrar-specific notes:

```yaml
name: acme
status: active
domains:
  - { name: acme.example,     registrar: vercel, role: canonical, renews: 2027-03-01, basis: rdap }
  - { name: acme-app.example, registrar: vercel, role: redirect,  renews: 2027-03-01, basis: rdap }
repo: github.com/example-owner/acme
deploy: { provider: vercel, project: acme }
dns_policy: observed
notes: >-
  Example venture. This public copy of rootsmith ships fictional manifests on
  RFC 2606-reserved .example domains; a real deployment keeps its portfolio in
  a private ops fork (README, "Running it for real").
```

### Top-level fields

| Field | Type | Notes |
|:--|:--|:--|
| `name` | `^[a-z0-9-]+$` | must match the filename; **required** |
| `status` | enum | `active` · `parked` · `sunsetting` · `archived`; **required** |
| `domains` | array, min 1 | see below; **required** |
| `repo` | string | `github.com/<owner>/<name>` — the venture's claim on exactly one repo (I1) |
| `deploy` | object | `{ provider: vercel, project: <name> }` — park/sunset detach domains from this project |
| `email` | object | `provider` + `routes[]` — park warns before merging when routes exist (email breaks silently) |
| `social` | map | **inert documentation** (I4): recorded, never drift-checked |
| `dns_policy` | enum | `managed` = manifest is DNS truth, mismatches audited · `observed` = report-only |
| `notes` | string | institutional memory — dated, and preserved by every automated edit |

`status` drives the repo audits (an `active` venture with an archived repo is drift; so is an `archived` venture with a live one) and the cert audit (only `active` ventures' `canonical` domains get TLS checks). `sunsetting` is schema-legal as a hand-set marker for long teardowns; no runbook emits it.

### Domain entries

| Field | Type | Notes |
|:--|:--|:--|
| `name` | hostname | **required** |
| `registrar` | enum | `vercel` · `godaddy` · `squarespace` · `unknown`; **required** |
| `role` | enum | `canonical` · `redirect` · `parked`; **required** |
| `renews` | date | reality-authoritative — the reconciler maintains it by auto-PR (I5) |
| `basis` | enum | provenance of `renews`: `rdap` (registry-attested) · `dashboard` · `manual` |
| `verify_by` | date | re-verification deadline for non-RDAP values (`.io` has no RDAP; `.ai` rate-limits) |
| `note` | string | `URGENT` or `FINDING` anywhere in it puts a `<<` flag in `rsm status` |
| `dns` | array | expected records — audited only under `dns_policy: managed` |

DNS records are `{ type, name, value, priority? }` with `type` one of `A` `AAAA` `CNAME` `MX` `TXT` `NS` and `name: "@"` for the apex. Declaring them under `dns_policy: observed` is legal but inert — the audit only fires where the manifest claims authority (I5).

### Both YAML styles are first-class

Flow style for dense portfolios, block style for entries carrying dated notes:

```yaml
domains:
  - { name: acme-app.example, registrar: vercel, role: redirect, renews: 2027-03-01, basis: rdap }
  - name: northwind.example
    registrar: unknown
    role: parked
    basis: manual
    verify_by: 2026-08-01
    note: >-
      FINDING (example, 2026-07-16): registrar unknown — dated findings ride
      in manifests and surface as << flags in `rsm status`.
```

This matters because automated edits — drift auto-PRs, runbook manifest flips — go through [`src/manifest-edit.ts`](../src/manifest-edit.ts), which patches the YAML **as text** in either style. A `js-yaml` round-trip would destroy comments and dated block notes, and those notes are the institutional memory of the whole system.

## The quarantine pen — `ventures/unassigned.yaml`

Created and maintained by the nightly reconciler, never by hand: a domain observed at Vercel but absent from every manifest gets auto-PR'd into `ventures/unassigned.yaml` as `role: parked, basis: manual` with a dated note and a 14-day `verify_by`. Merging restores I1 — every asset in exactly one manifest — and moving the entry to its real venture (or archiving it) is the operator's follow-up. This file existing at all means the map disagreed with the territory.

## The repo registry — `repos.yaml`

I1 extended to GitHub: every **owned** repo either belongs to exactly one venture (its manifest's `repo:` field) or carries a disposition here. A repo in neither place is drift, and the nightly sweep quarantines it by auto-PR.

```yaml
repos:
  - { name: example-owner/rootsmith, disposition: keep, note: "control plane — this repo" }
  - { name: example-owner/legacy-site, disposition: archive, note: "superseded 2026-05; runbook plan archive-repos converges it" }
  - { name: example-owner/prototype-7, disposition: unassigned, note: "observed 2026-07-16 (I1 sweep) — triage me" }
```

Dispositions are **desired state** (manifest-authoritative, I5):

| Disposition | Means | The nightly run |
|:--|:--|:--|
| `keep` | stays un-archived, not venture-tied | files an issue if observed archived |
| `archive` | should be archived | files an issue until a [`runbook plan archive-repos`](./runbooks.md#archive-repos) PR converges it |
| `ignore` | not reconciled | skips it entirely (the I4 posture for repos) |
| `unassigned` | quarantined by the sweep | awaits triage — assign to a venture or pick a disposition |

Org repos (outside the token's `affiliation=owner` sweep) are audited when a venture claims them, but never swept into the registry.

> [!TIP]
> `rsm repos` prints the joined view — every owned repo with its claim — and is the fastest way to triage the `unassigned` backlog. Duplicate claims (two ventures, or a venture *and* the registry, naming the same repo) are themselves drift: `repo-duplicate-claim`.

## Validation

```sh
rsm validate
```

```text
OK — 2 ventures, 3 domains, 4 registry repos, schema-valid.
```

Schemas live in [`schema/venture.schema.json`](../schema/venture.schema.json) and [`schema/repos.schema.json`](../schema/repos.schema.json) (JSON Schema draft 2020-12, compiled with Ajv). Manifests are parsed with `yaml.JSON_SCHEMA` so unquoted ISO dates stay strings — the strict schema rightly rejects coerced `Date` objects.

---

← [README](../README.md) · [docs index](./README.md)
