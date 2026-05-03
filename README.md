![Gittrix logo](https://raw.githubusercontent.com/cloudboy-jh/gittrix/main/gittrix.png)

# Gittrix

Gittrix is a storage router for AI coding workflows.

It keeps agent work in ephemeral session repos and only moves accepted changes to your real repo when a human promotes them.

## Why this exists

- Agents generate a lot of throwaway code.
- Direct agent commits pollute real history.
- You need a clean promotion gate controlled by humans.

Gittrix gives you that gate.

## What you get

- Ephemeral session workspace per task
- Agent API with no durable-write path
- Human-only `promote` operation
- Baseline conflict detection before promote
- Single synthetic commit on durable for clean history
- Pluggable durable adapters — works with any git remote, GitHub, or self-hosted forge

## Current status

v0.2 interface split + cloudflare-artifacts adapter.

Implemented now:

- `@gittrix/core`
- `@gittrix/adapter-local`
- `@gittrix/adapter-cloudflare-artifacts`
- `gittrix` CLI

## Storage options

```mermaid
flowchart TD
  A["Gittrix"]

  subgraph Durable[Durable providers]
    DL["Local\nAvailable"]
    DCF["Cloudflare Artifacts\nAvailable"]
    DR["Git Remote\nPlanned"]
    DGH["GitHub\nPlanned"]
    DGL["GitLab\nPlanned"]
    DCS["Code Storage\nPlanned"]
  end

  subgraph Ephemeral[Ephemeral providers]
    EL["Local\nAvailable"]
    ECF["Cloudflare Artifacts\nAvailable"]
    EGF["GitFork\nPlanned"]
    ECS["Code Storage\nPlanned"]
  end

  A --> Durable
  A --> Ephemeral

  classDef core fill:#E3F2FD,stroke:#1E88E5,color:#0D47A1,stroke-width:2px;
  classDef available fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px;
  classDef planned fill:#F3E5F5,stroke:#8E24AA,color:#4A148C,stroke-width:2px;

  class A core;
  class DL,DCF,EL,ECF available;
  class DR,DGH,DGL,DCS,EGF,ECS planned;
```

## How promotion works

```mermaid
flowchart TD
  P["Promote session changes\ngittrix promote <session-id>"]
  P --> A["Auto\nGittrix picks the best path"]
  P --> C["Commit\nWrite one clean commit directly"]
  P --> B["Branch\nSend changes to a branch"]
  P --> PR["Pull Request\nOpen a PR (adapter must support PRs)"]
  P --> PT["Patch\nExport as a patch file"]
  P --> BR["Optional: --branch=<name>\nUse with Branch or Pull Request"]

  classDef start fill:#E3F2FD,stroke:#1E88E5,color:#0D47A1,stroke-width:2px;
  classDef direct fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px;
  classDef review fill:#FFF3E0,stroke:#FB8C00,color:#E65100,stroke-width:2px;
  classDef export fill:#F3E5F5,stroke:#8E24AA,color:#4A148C,stroke-width:2px;

  class P start;
  class A,C direct;
  class B,PR,BR review;
  class PT export;
```

## Install

```bash
bun install
```

## Build, typecheck, test

```bash
bun run build
bun run typecheck
bun run test
```

## Test harness

```bash
bun run testharness --
bun run testharness -- --integration
bun run testharness -- --all
bun run testharness -- --typecheck
```

## Docs

- `docs/SPEC.md`
- `docs/migration-v0.2.md`
- `docs/test-scripts.md`


## Mental model

1. Start session from durable baseline.
2. Agent edits and commits in ephemeral workspace.
3. Human reviews diff and promotes accepted changes.
4. Gittrix writes one clean commit to durable.
5. Session is evicted per policy.

## License

MIT
