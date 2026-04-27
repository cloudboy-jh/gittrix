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

## Current status

v0.1 local MVP.

Implemented now:

- `@gittrix/core`
- `@gittrix/adapter-local`
- `gittrix` CLI

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

## CLI quickstart

Start a session:

```bash
gittrix s start "add login flow" /absolute/path/to/your/repo main
```

List sessions:

```bash
gittrix s list
```

Inspect changes:

```bash
gittrix session diff <session-id>
gittrix session log <session-id>
```

Promote all touched files:

```bash
gittrix p <session-id> -m "Add login flow"
```

Promote selected files only:

```bash
gittrix p <session-id> --files=src/auth.ts,src/session.ts -m "Promote auth/session"
```

JSON output mode:

```bash
gittrix s list --json
```

## Mental model

1. Start session from durable baseline.
2. Agent edits and commits in ephemeral workspace.
3. Human reviews diff and promotes accepted changes.
4. Gittrix writes one clean commit to durable.
5. Session is evicted per policy.

## License

MIT
