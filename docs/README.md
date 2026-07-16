# rootsmith docs

The [README](../README.md) is the front door; [SPEC.md](../SPEC.md) is the *why* (thesis, invariants, roadmap, open decisions, kill triggers); these pages are the *how*. Code comments cite invariants by number — every `I1`…`I7` reference resolves in [SPEC.md §1](../SPEC.md#1-design-invariants).

| Page | Read it when |
|:--|:--|
| [setup.md](./setup.md) | wiring tokens, the `apply` environment, and the workflows — or wondering what a missing credential costs |
| [cli.md](./cli.md) | you need a flag, an exit code, or to know what a command actually prints |
| [manifests.md](./manifests.md) | writing or reviewing `ventures/*.yaml` / `repos.yaml`, field by field |
| [drift.md](./drift.md) | a nightly issue landed and you want to know what fires it and what closes it |
| [runbooks.md](./runbooks.md) | planning, reviewing, or applying a mutation — park, provision, sunset, archive-repos |
| [mcp.md](./mcp.md) | registering the server or checking what a tool can and cannot do |
