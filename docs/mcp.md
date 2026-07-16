# MCP server

[`src/mcp/server.ts`](../src/mcp/server.ts) exposes the manifests and the live reconciler to Claude (or any MCP client) over stdio, as server `rootsmith`. The posture mirrors the CLI's (I3): five read tools, plus exactly one write-shaped tool whose entire write capability is *opening a pull request*.

> [!NOTE]
> stdout is the protocol channel — all server logging goes to stderr. The server reads the same manifests and calls the same `collectDrift` as the CLI, so answers match `rsm` output exactly.

## Registering

The checked-in [`.mcp.json`](../.mcp.json) does this for Claude Code — opening the repo prompts you to approve the project server, and that's the whole setup:

```json
{
  "mcpServers": {
    "rootsmith": {
      "command": "node",
      "args": ["--import", "tsx", "src/mcp/server.ts"]
    }
  }
}
```

It launches `node` directly rather than `npm run mcp` because `npm` is a `.cmd` shim on Windows, which MCP clients cannot spawn without a `cmd /c` wrapper — `node --import tsx` is the same runtime `npm test` uses and works identically on every platform. `npm run mcp` remains the way to run the server by hand.

Any other stdio-capable client takes the same shape: command `node`, args `--import tsx src/mcp/server.ts`, cwd = this repo (the server shells out to `git` against the checkout, and `tsx` resolves from its `node_modules`). Imperatively, from the repo root:

```sh
claude mcp add rootsmith -- node --import tsx src/mcp/server.ts
```

## Tools

| Tool | Input | Returns |
|:--|:--|:--|
| `list_ventures` | — | every venture: name, status, domain names |
| `get_venture` | `name` | one full manifest |
| `renewals_within` | `days` | renewals/expiries in the window, plus domains with **unknown** renewal dates |
| `list_repos` | — | owned repos × venture/registry claims, plus org-repo claims outside the sweep |
| `list_drift` | `deep?` | live two-tier findings + degraded-source list; `deep` adds the crt.sh sweep (slow) |
| `open_runbook_plan` | `runbook`, `venture?`, `params?` | opens a plan PR and reports branch, plan path, PR URL |

`list_repos` needs a GitHub token (locally, `gh auth login` suffices — the fallback chain is the [same as the CLI's](./cli.md#environment)). `list_drift` works tokenless; missing sources appear in its `degraded` list rather than failing the call (I6).

### `open_runbook_plan`

The only write-shaped tool, and all it does is open a PR — merging remains a human act, and `apply-on-merge` remains the only write path (I3):

| Param | Notes |
|:--|:--|
| `runbook` | `park` · `provision` · `sunset` · `archive-repos` |
| `venture` | required except for `archive-repos`, which is registry-scoped |
| `params.domain` | provision: the fqdn to register (required there) |
| `params.repo` / `params.project` | provision: default to the venture name |
| `params.release` | sunset: plan letting registrations lapse (manual registrar step, I7) |

What each runbook plans — including which steps are destructive — is documented in [runbooks.md](./runbooks.md).

## Conversations this enables

- *"What renews this quarter?"* → `renewals_within(92)` — the M3 completion threshold, answered from the manifest with unknowns surfaced as findings.
- *"Anything drifting right now?"* → `list_drift` — the same two-tier classification the nightly run files.
- *"Park acme."* → `open_runbook_plan(park, acme)` — Claude's authority ends at the PR; yours begins at the merge button.

---

← [README](../README.md) · [docs index](./README.md)
