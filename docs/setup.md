# Setup and wiring

Local use needs nothing but Node; the full nightly + apply loop needs four credentials in two very different places — that separation *is* invariant I2, so resist the urge to consolidate them.

> [!IMPORTANT]
> The GitHub wiring below belongs on a **private ops fork**, never on the public repo: the machinery's outputs — drift issues, manifest auto-PRs, plan PRs — contain the portfolio itself. The public repo ships fictional example manifests and stays inert (both operational workflows are gated on the `ROOTSMITH_OPS` variable). The fork recipe is in the [README](../README.md#-running-it-for-real).

## Local

Prerequisites: Node ≥ 22 (CI pins 22; the code leans on built-in `fetch`), npm, git. Optional: the `gh` CLI — its `gh auth token` is the zero-config local fallback for every GitHub read.

```sh
npm install
npm run cli -- validate
npm run cli -- status
npm run cli -- drift
```

RDAP, DNS-over-HTTPS, crt.sh, and live TLS checks are tokenless — `drift` is useful from the first minute. Add these to taste:

| Variable | Unlocks locally |
|:--|:--|
| `VERCEL_TOKEN` (read-only) | expiry fallback for `.io`/`.ai`, `status --live` joins, unmanifested-asset audit |
| `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth login` | `rsm repos`, repo audits, opening plan PRs |

> [!NOTE]
> Nothing loads a `.env` file (it's gitignored as a courtesy, not read) — export variables in your shell or use direnv.

## GitHub wiring — one-time, on the private ops fork

### 0. Arm the workflows

Settings → Secrets and variables → Actions → **Variables** → new repository variable `ROOTSMITH_OPS` = `true`. Both [`drift-nightly`](../.github/workflows/drift-nightly.yml) and [`apply-on-merge`](../.github/workflows/apply-on-merge.yml) are gated on it, so clones and the public repo never file issues about manifests that aren't a real portfolio.

### 1. Repository secrets (read side)

| Secret | Make it | Notes |
|:--|:--|:--|
| `VERCEL_READ_TOKEN` | Vercel token, read-only scope | joins Vercel to the nightly run |
| `GH_READ_TOKEN` | fine-grained PAT: **read** on metadata + contents, all owned repos | the nightly repo audits need account-wide visibility that `github.token` lacks |

### 2. The `apply` environment (write side)

Settings → Environments → **New environment** → `apply`:

- [ ] Enable **Required reviewers** and add yourself — this is the second gate on every mutation, and it is free
- [ ] Add environment secret `VERCEL_WRITE_TOKEN` (full scope — plan steps buy domains, create/delete projects)
- [ ] Add environment secret `GH_WRITE_TOKEN` (PAT that can create and archive repos — plan steps act beyond this repo, which `github.token` cannot)

> [!WARNING]
> Write tokens go **only** here. Never as repository secrets: repo secrets are visible to every workflow run, and the whole design rests on the nightly job being physically unable to mutate anything (I2).

### 3. First runs

- [ ] Actions tab → `drift-nightly` → **Run workflow** — triage what it files; a freshly backfilled portfolio usually carries a finding or two
- [ ] Labels `drift` and `runbook-plan` are created on demand by the tooling — nothing to pre-create
- [ ] When ready to prove the write path: `rsm runbook plan park <venture>` on the lowest-stakes venture, review, merge, approve the environment run (M4's threshold)

### 4. MCP

Nothing to wire: the checked-in [`.mcp.json`](../.mcp.json) registers the server for Claude Code — approve it when prompted. Other clients: [mcp.md](./mcp.md).

## The three workflows

| Workflow | Trigger | Credentials | Does |
|:--|:--|:--|:--|
| [`ci`](../.github/workflows/ci.yml) | push, PR | none | typecheck, tests, strict manifest validation |
| [`drift-nightly`](../.github/workflows/drift-nightly.yml) | 06:17 UTC + manual | read tokens only | `drift --deep --report` → issues + auto-PRs |
| [`apply-on-merge`](../.github/workflows/apply-on-merge.yml) | merged PR labeled `runbook-plan` | write tokens, `apply` env | executes the plan files the PR added |

The nightly cron minute is jittered (`:17`) to be polite to RDAP endpoints. The nightly job's only write scope is on this control repo — issues and manifest PRs — never on the world.

## Degradation matrix

What each missing credential costs — and nothing more (I6):

| Missing | Still works | Lost |
|:--|:--|:--|
| `VERCEL_TOKEN` | RDAP/DNS/cert/CT audits, all repo audits | `.io`/`.ai` expiry fallback; unmanifested-**asset** audit |
| any GitHub token | all domain audits, drift to stdout | repo audits; `--report` degrades to a markdown table |
| `GH_READ_TOKEN` in CI | control-repo issues/PRs via `github.token` | account-wide repo sweep (`github.token` sees only this repo) |
| RDAP for a TLD | Vercel fallback when token present; `verify_by` discipline otherwise | registry-attested expiry (`basis: rdap`) |

---

← [README](../README.md) · [docs index](./README.md)
