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

## Storage options

```mermaid
flowchart TD
  A["Gittrix"]

  subgraph CoreAdapters[Available now / next]
    L["Local Git\nWorks on your machine\n(session + final repo)\n✅ Available now"]
    R["Any Git Remote\nWorks with any HTTPS/SSH git host\n(session + final repo)\n🛠️ Next up"]
  end

  subgraph ForgeAware[Planned platform-specific options]
    GH["GitHub\nFinal repo + PR creation"]
    CS["Code Storage\nSession repo + final repo\nBuilt-in session expiry"]
    CF["Cloudflare Artifacts\nSession repo"]
    GF["GitFork\nSession repo"]
    GL["GitLab\nFinal repo + MR creation"]
  end

  A --> L
  A --> R
  R --> GH
  R --> CS
  R --> CF
  R --> GF
  R --> GL

  classDef core fill:#E3F2FD,stroke:#1E88E5,color:#0D47A1,stroke-width:2px;
  classDef available fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px;
  classDef next fill:#FFF8E1,stroke:#F9A825,color:#E65100,stroke-width:2px;
  classDef planned fill:#F3E5F5,stroke:#8E24AA,color:#4A148C,stroke-width:2px;

  class A core;
  class L available;
  class R next;
  class GH,CS,CF,GF,GL planned;
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


## Mental model

1. Start session from durable baseline.
2. Agent edits and commits in ephemeral workspace.
3. Human reviews diff and promotes accepted changes.
4. Gittrix writes one clean commit to durable.
5. Session is evicted per policy.

## License

MIT
