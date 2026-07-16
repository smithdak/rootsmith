# CLI reference

Every command reads the manifests; none of them writes to the world. The single write-shaped command, `runbook plan`, opens a pull request (I3) — [`runbook apply`](#rsm-runbook-apply) exists for the `apply-on-merge` workflow, not for hands.

All examples below use the alias:

```sh
alias rsm="npm run cli --"
```

Output samples are captured from real runs against the bundled example manifests (2026-07-16) — fictional ventures on RFC 2606-reserved `.example` domains. A real deployment's output has the same shape with its own portfolio.

## Environment

The CLI degrades per-source instead of failing when credentials are absent (I6) — see the [degradation matrix](./setup.md#degradation-matrix) for exactly what each missing token costs.

| Variable | Used by | Absent means |
|:--|:--|:--|
| `VERCEL_TOKEN` | Vercel reads: expiry fallback, domain list | `.io`/`.ai` fallback and the unmanifested-asset audit are skipped |
| `GITHUB_TOKEN` / `GH_TOKEN` | control-repo writes: issues, PRs, plan branches | falls back to `gh auth token`; else reporting degrades to markdown |
| `GH_REPOS_TOKEN` | account-wide repo reads (nightly) | falls back to `GITHUB_TOKEN`, then `gh auth token` |

> [!NOTE]
> Nothing loads a `.env` file — set variables in your shell (or let `gh auth login` cover the GitHub side locally).

## `rsm status`

The manifest view: every venture, every domain, urgency flags surfaced from dated notes.

```sh
rsm status
```

```text
acme  [active]  dns_policy=observed
  acme.example         vercel      canonical renews=2027-03-01 basis=rdap
  acme-app.example     vercel      redirect  renews=2027-03-01 basis=rdap

northwind  [parked]  dns_policy=observed
  northwind.example    unknown     parked    renews=?          basis=manual     << FINDING
```

With `--live`, each domain also gets an observed line — expiry from RDAP (Vercel as fallback), nameservers from DNS-over-HTTPS, and a `DRIFT` marker when observed expiry disagrees with the manifest. This is the M1 table that must match the dashboards. RDAP and DNS need no tokens.

```sh
rsm status --live
```

| Flag | Effect |
|:--|:--|
| `--live` | join observed expiry + NS per domain |

Exit: `0` always.

## `rsm validate`

Strict schema check over `ventures/*.yaml` and `repos.yaml`. Unknown fields fail — in CI and everywhere else.

```sh
rsm validate
```

```text
OK — 2 ventures, 3 domains, 4 registry repos, schema-valid.
```

Exit: `0` when valid; a schema violation throws with a per-file error list.

## `rsm renewals`

Upcoming renewals from the manifest, plus every domain whose renewal date is unknown — an unknown expiry is a finding, not a blank.

```sh
rsm renewals --within 90
```

```text
Nothing renews within 90 days.
?? northwind.example (northwind) renewal date UNKNOWN — FINDING (example, 2026-07-16): registrar unknown …
```

Expired entries are prefixed `!!`; near-window entries print flush with the date, basis, and days remaining:

```text
   acme.example (acme) renews in 77d — 2026-10-01 [basis: rdap]
```

| Flag | Effect |
|:--|:--|
| `--within N` | window in days (default `90`) |

Exit: `1` if anything in the window is already **expired**, else `0` — expired lines are prefixed `!!`.

## `rsm repos`

The all-repos view: observed GitHub state joined against venture claims and `repos.yaml` dispositions. Read-only — [`drift`](#rsm-drift) does the signaling.

```sh
rsm repos
```

Each row shows `owner/name`, flags (`archived`, `fork`, `private`/`public`), last push, and its claim: `venture:<name>`, `registry:<disposition>`, or `UNMANIFESTED`. Repos claimed by a venture but outside the owned-repo sweep (org repos) are listed separately; a claim that 404s at GitHub is flagged `MISSING`. A summary line totals the three claim classes.

Exit: `2` when no GitHub token can be resolved.

## `rsm drift`

The full audit pass (spec §4), shared verbatim by the CLI, the MCP `list_drift` tool, and the nightly workflow. Live output from 2026-07-16 against the example manifests — `.example` domains are deliberately unregistrable, and the reconciler correctly says exactly that:

```sh
rsm drift
```

```text
[reality] acme.example             possibly-unregistered  RDAP 404 at a working registry endpoint — acme.example may be unregistered; locate the holding account, re-register or archive
[manifest] acme.example             undelegated            no NS delegation at the registry — restore delegation or set the venture entry to archived (fix the world, I5)
[reality] acme-app.example         possibly-unregistered  RDAP 404 at a working registry endpoint — acme-app.example may be unregistered; …
[manifest] acme-app.example         undelegated            no NS delegation at the registry — …
[reality] northwind.example        possibly-unregistered  RDAP 404 at a working registry endpoint — northwind.example may be unregistered; …
[manifest] northwind.example        undelegated            no NS delegation at the registry — …
  degraded: acme.example: rdap degraded — NOT FOUND at registry — domain may be unregistered
  degraded: acme-app.example: rdap degraded — NOT FOUND at registry — domain may be unregistered
  degraded: northwind.example: rdap degraded — NOT FOUND at registry — domain may be unregistered
  degraded: vercel domain list — VERCEL_TOKEN not set (unmanifested-asset audit skipped)
```

Without a GitHub token the repo audits degrade the same way (`github repo list — … (repo audits skipped)`).

The `[reality]`/`[manifest]` prefix is the two-tier classification (I5); `degraded:` lines are sources that could not attest — logged to stderr, never fatal (I6). Every kind in the catalog is documented in [drift.md](./drift.md).

| Flag | Effect |
|:--|:--|
| `--deep` | add the crt.sh dangling-CNAME sweep (slow; CI-oriented) |
| `--report` | file findings as fingerprint-deduped issues + manifest auto-PRs |
| `--within N` | renewal window in days (default `90`) |

Exit: `1` when drift was found, `0` when clean — except with `--report`, which exits `0` once reporting succeeded, because there the issues *are* the signal. The nightly workflow runs `drift --deep --report`.

## `rsm runbook plan`

Compute every intended API call for a lifecycle operation and open a plan PR. **Never executes anything.**

```sh
rsm runbook plan park acme
rsm runbook plan provision zephyr --domain zephyr.dev --repo zephyr --project zephyr
rsm runbook plan sunset acme --release
rsm runbook plan archive-repos
```

It prints the plan path, the branch, and what happened to the PR (shape, not a captured run — planning pushes a branch):

```text
plan:   plans/acme-park-2026-07-16.json
branch: runbook/park-acme
opened plan PR <url>
```

| Flag | Applies to | Effect |
|:--|:--|:--|
| `--domain <fqdn>` | `provision` | the domain to register (required) |
| `--repo <name>` | `provision` | repo name (default: venture name) |
| `--project <name>` | `provision` | Vercel project name (default: venture name) |
| `--release` | `sunset` | plan letting registrations lapse (manual registrar step — never an API call, I7) |

The plan and its manifest edits are committed to a `runbook/<rb>-<venture>` branch by pure git plumbing — your working tree, index, and current branch are untouched. Without a token or `origin` remote it still commits and tells you what to push by hand. `archive-repos` is registry-scoped: the venture argument is ignored.

Exit: `0` when the PR opened (spec §3), `1` when it could not, `2` on usage error.

## `rsm runbook apply`

Execute a merged, reviewed plan file — the only code path that mutates the world (I3). Run exclusively by [`apply-on-merge`](../.github/workflows/apply-on-merge.yml) inside the `apply` environment; invoking it by hand outside that environment fails fast because the write tokens don't exist anywhere else (I2).

```sh
rsm runbook apply plans/acme-park-2026-07-16.json
```

Stops at the first unexpected HTTP status, leaving a loudly half-applied state for the nightly reconcile to surface. Manual steps in the plan are echoed as a checklist for the operator. Exit: `0` applied, `1` stopped.

## npm scripts

| Script | Runs |
|:--|:--|
| `npm run cli -- <cmd>` | any CLI command via `tsx` |
| `npm run validate` / `status` / `drift` | shorthands for those commands |
| `npm run mcp` | the MCP server on stdio |
| `npm test` | `node --test` over `manifest-edit` and `repos` suites (12 tests) |
| `npm run typecheck` | `tsc --noEmit` |

---

← [README](../README.md) · [docs index](./README.md)
