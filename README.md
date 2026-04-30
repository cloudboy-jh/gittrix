![Gittrix logo](./gittrix.png)

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

v0.1 local MVP.

Implemented now:

- `@gittrix/core`
- `@gittrix/adapter-local`
- `gittrix` CLI

## Storage adapter options (per spec)

```mermaid
flowchart TD
  A["Gittrix Core"]

  subgraph CoreAdapters[Core adapters]
    L["@gittrix/adapter-local\nDurable + Ephemeral\nv0.1 done"]
    R["@gittrix/adapter-git-remote\nDurable + Ephemeral\nHTTPS/SSH generic git transport\nv0.2 priority"]
  end

  subgraph ForgeAware[Forge-aware adapters]
    GH["@gittrix/adapter-github\nDurable\npr: true via Octokit"]
    CS["@gittrix/adapter-codestorage\nDurable + Ephemeral\nttl: true"]
    CF["@gittrix/adapter-cloudflare\nEphemeral\nCloudflare Artifacts wrapper"]
    GF["@gittrix/adapter-gitfork\nEphemeral\nURL-as-API"]
    GL["@gittrix/adapter-gitlab\nDurable\npr: true (MR creation)"]
  end

  A --> L
  A --> R
  R --> GH
  R --> CS
  R --> CF
  R --> GF
  R --> GL
```

## Git options (per spec)

```mermaid
flowchart TD
  P["gittrix promote <session-id>"]
  P --> A["--strategy=auto"]
  P --> C["--strategy=commit"]
  P --> B["--strategy=branch"]
  P --> PR["--strategy=pr\nrequires durable adapter pr: true"]
  P --> PT["--strategy=patch"]
  P --> BR["--branch=<name>\noptional with branch/pr"]
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


## Mental model

1. Start session from durable baseline.
2. Agent edits and commits in ephemeral workspace.
3. Human reviews diff and promotes accepted changes.
4. Gittrix writes one clean commit to durable.
5. Session is evicted per policy.

## License

MIT
