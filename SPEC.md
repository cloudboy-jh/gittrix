# gittrix

Ephemeral storage router for AI coding agents. Agents work in throwaway repos, humans promote accepted changes to durable storage, and your real history stays clean.

- **Status:** v0.1 spec — pre-implementation
- **License:** MIT
- **Author:** Jack Horton (cloudboy-jh)

## 1. Why

AI coding agents generate enormous volumes of speculative code. Most of it is wrong, redundant, or abandoned mid-task. The current default — agents committing directly to real repos through GitHub-style workflows — produces unreviewable history, polluted main branches, and a maintainer experience nobody enjoys.

The infrastructure to do better exists but isn't composed. Cloudflare ships ephemeral compute and storage primitives. Pierre ships purpose-built git infrastructure for machines. GitFork ships URL-as-API ephemeral repos. Local filesystems and GitHub still anchor the durable side. None of these talk to each other through a common interface, and no consumer-facing tool exposes the pattern that actually makes them useful: agents work in ephemeral, humans promote to durable, slop never lands.

Gittrix is that interface. It's a small library that routes agent writes to ephemeral storage, gates promotion to durable storage on explicit human action, and abstracts the backends so they're swappable. It does one thing and stops.

## 2. Core thesis

Agent-generated state is overwhelmingly ephemeral and should be treated as such. The substrate for AI coding tools should default to throwaway storage with explicit promotion gates, not to durable storage with cleanup conventions. Gittrix encodes that principle as code.

Three load-bearing claims follow:

- Agents have no path to durable storage. Promotion is a human-only operation, enforced structurally — not by convention or prompt engineering. The agent's API surface excludes any method that touches durable.
- Storage backends are a runtime, not a destination. The user (or consumer) picks where ephemeral and durable live. Gittrix routes accordingly. GitHub, local filesystem, Code Storage, Cloudflare Artifacts, GitFork — all swappable through one adapter interface.
- Promotion is a content-level operation, not a history-level one. When a user promotes, they accept hunks or files. The agent's intermediate commits in ephemeral are debugging artifacts; only the user-curated outcome lands on durable as clean commits.

## 3. Architecture overview

```text
┌─────────────────────────────────────────┐
│  Consumer (glib-code, CLI, other)      │
│  - Calls library API or CLI            │
│  - Holds UserSession (with promote())  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  @gittrix/core                          │
│  - GitTrix router                       │
│  - Session lifecycle (overlay reads,    │
│    ephemeral writes, promotion gate)    │
│  - Capability negotiation               │
│  - Eviction                             │
└──────┬──────────────────────────┬───────┘
       │                          │
       ▼                          ▼
┌─────────────────┐        ┌─────────────────┐
│  Ephemeral      │        │  Durable        │
│  Adapter        │        │  Adapter        │
│  (any byte      │        │  (must be       │
│   store)        │        │   git-capable)  │
└─────────────────┘        └─────────────────┘
```

Agent receives `AgentSession` (no promote method). User UI receives `UserSession` (full control).

## 4. Concepts

### 4.1 Session

A session is one unit of agent work. Lifecycle:

1. Consumer calls `gittrix.startSession({ task, durable, ephemeral })`
2. Gittrix records the durable HEAD as baseline, creates an ephemeral fork of durable
3. Agent receives an `AgentSession` handle and works freely (read, write, commit, branch in ephemeral)
4. Consumer (human-facing UI) holds a `UserSession` and observes
5. User reviews diff against baseline, accepts a subset of changes
6. Consumer calls `userSession.promote(...)` — gittrix moves accepted changes to durable
7. Session evicts (immediately on promote, or via TTL if abandoned)

Sessions have stable IDs, persist across process restarts (metadata is on disk), and can be resumed by ID.

### 4.2 Refs

A `Ref` points to a repo on a specific backend. Tagged union, discriminated by `type`:

```ts
type Ref =
  | { type: 'local'; path: string; branch?: string }
  | { type: 'git-remote'; url: string; branch?: string; auth?: AuthRef }
  | { type: 'github'; owner: string; repo: string; branch?: string }
  | { type: 'codestorage'; namespace: string; repo: string; branch?: string }
  | { type: 'cloudflare'; namespace: string; key: string }
  | { type: 'gitfork'; slug: string }
```

Each variant serializes to a stable URI (`github://owner/repo#branch`, `local:///abs/path#branch`, etc.) for logging, metadata storage, and CLI display.

`git-remote` serializes as:

`git-remote://<url-encoded-remote>#<branch>`

### 4.3 Adapters

Adapters wrap a specific backend and implement the `StorageAdapter` interface. Adapters declare their capabilities; the router validates pairings at construction.

```ts
interface AdapterCapabilities {
  git: boolean              // full git semantics (branches, commits, log, diff)
  push: boolean             // can push to other adapters
  fetch: boolean            // can pull from other adapters
  history: boolean          // log() returns meaningful results
  pr: boolean               // can create PR/MR via forge API
  ttl: boolean              // native TTL support
  maxBlobSize?: number
  latencyClass: 'local' | 'edge' | 'regional'
}
```

Durable adapters must have `git: true`. Ephemeral adapters can have any capabilities; gittrix wraps non-git ephemerals through a thinner interface.

`git-remote` is a generic git transport adapter over HTTPS/SSH. It shells out to `git push`, `git fetch`, `git ls-remote`, and related commands against the configured remote. It does not implement forge-specific APIs or auth flows beyond standard git credential handling.

### 4.4 Overlay reads, ephemeral writes

When the agent reads a file, gittrix checks ephemeral first; if absent, falls through to durable at baseline. This means:

- Session start is cheap. Files are materialized into ephemeral only when touched.
- The agent's view of the codebase is stable across the session, even if durable changes.
- Conflict detection happens at promote time, not read time.

When the agent writes, the write always lands in ephemeral. Durable is never touched until promote.

### 4.5 Promotion

Promotion is the only path from ephemeral to durable. It is:

- Human-only. The agent's API surface excludes promotion.
- Selective. The user picks hunks, files, or all changes via the consumer's UI.
- Synthetic. Promoted commits are derived from accepted changes, not replayed agent history.
- Conflict-aware. If durable HEAD has moved since baseline **and** there's overlap with agent-touched files, gittrix throws `BaselineConflictError` and refuses to auto-promote.

Promote strategies are decided per-repo on first session, with auto-detection.

Detection (one-time):

- contributor count from `git shortlog -sn --all`
- branch protection on durable (if applicable)
- recent PR activity

Defaults:

- `1 contributor + no remote PRs` → commit to current branch
- `2-5 contributors` → ask user once, default to branch
- `6+ contributors OR branch protection` → must branch (no prompt)

Saved as `RepoPreference`, keyed by durable URI.

Strategies:

- `commit` — apply accepted changes as commit on current branch of durable
- `branch` — create branch `gittrix/{slugified-task-name}` and apply there
- `pr` — branch + open PR (requires durable adapter `pr: true` capability, e.g. GitHub)
- `patch` — emit patch file, don't apply

Override hierarchy: hard override (branch protection) → per-session override → per-repo preference → global default → heuristic.

### 4.6 Eviction

Sessions die. Default policy: `ttl_idle: 4h + until_promote: true`.

Per-session config options:

- `ttl_absolute` — hard wall-clock deadline
- `ttl_idle` — sliding window, resets on read/write
- `until_promote` — auto-evict immediately on successful promote
- `manual` — only evict on explicit destroy

Adapters with native TTL (Code Storage, GitFork) handle eviction themselves. Adapters without (local tmp, Cloudflare Artifacts) get explicit `evict(beforeTimestamp)` calls from gittrix's eviction daemon.

## 5. API

### 5.1 Library — `@gittrix/core`

```ts
import { GitTrix } from '@gittrix/core'
import { LocalFsAdapter } from '@gittrix/adapter-local'
import { CloudflareArtifactsAdapter } from '@gittrix/adapter-cloudflare'

const gittrix = new GitTrix({
  durable: new LocalFsAdapter({ path: '/Users/jack/code/myproject' }),
  ephemeral: new CloudflareArtifactsAdapter({
    credentials: async () => ({ token: await getToken() }),
    namespace: 'glib'
  }),
  defaultEviction: { ttlIdle: '4h', untilPromote: true }
})

// Start a session
const session = await gittrix.startSession({
  task: 'add login flow',
  durableBranch: 'main'
})

// Hand the agent a narrowed view
const agentSession = session.forAgent()
await agentSession.write('src/auth.ts', bytes)
await agentSession.commit('add auth scaffold')

// User-facing operations
const diff = await session.diff()
const result = await session.promote({
  selector: { hunks: acceptedHunks },
  strategy: 'auto',
  message: 'Add login flow'
})
// result: { sha, branch, prUrl? }
```

### 5.2 AgentSession vs UserSession

Two interfaces, structurally separated:

```ts
interface AgentSession {
  read(path: string): Promise<Bytes>
  write(path: string, bytes: Bytes): Promise<void>
  commit(message: string): Promise<Sha>
  writeAndCommit(opts: { files: Record<string, Bytes>, message: string }): Promise<Sha>
  list(path: string): Promise<Entry[]>
  diff(): Promise<UnifiedDiff>
  log(): Promise<Commit[]>
}

interface UserSession extends AgentSession {
  promote(opts: PromoteOpts): Promise<PromoteResult>
  discard(): Promise<void>
  extend(ttl: Duration): Promise<void>
  forAgent(): AgentSession  // narrows to AgentSession
}
```

The `AgentSession` has no `promote`. There is no configuration that adds it. There is no escape hatch. This is the structural safety guarantee.

### 5.3 Events

Read-only observability. No mutation. No middleware chain.

```ts
gittrix.on('session.start', (e) => {})
gittrix.on('session.write', (e) => {})
gittrix.on('session.commit', (e) => {})
gittrix.on('session.promote', (e) => {})
gittrix.on('session.evict', (e) => {})
gittrix.on('error', (e) => {})
```

### 5.4 Errors

Typed errors, stable string codes, structured fields where useful.

```ts
class GittrixError extends Error { code: string }

class AdapterUnavailableError extends GittrixError      // 'ADAPTER_UNAVAILABLE'
class AuthError extends GittrixError                    // 'AUTH_FAILED'
class CapabilityMissingError extends GittrixError       // 'CAPABILITY_MISSING'
class SessionNotFoundError extends GittrixError         // 'SESSION_NOT_FOUND'
class SessionExpiredError extends GittrixError          // 'SESSION_EXPIRED'
class BaselineConflictError extends GittrixError {      // 'BASELINE_CONFLICT'
  conflictingFiles: string[]
  durableSha: string
  baselineSha: string
}
class PromoteFailedError extends GittrixError {         // 'PROMOTE_FAILED'
  stage: 'staging' | 'apply' | 'cleanup'
  cause: Error
}
class WriteRejectedError extends GittrixError           // 'WRITE_REJECTED'
class EvictionRaceError extends GittrixError            // 'EVICTION_RACE'
```

### 5.5 Auth

Adapters take credential providers. Static tokens are sugar over the callback.

```ts
// Provider callback (real interface)
new GitHubAdapter({
  credentials: async () => ({ token: await getOAuthToken() })
})

// Sugar for scripts
new GitHubAdapter({ token: 'ghp_...' })
```

The provider is called whenever the adapter needs credentials. The consumer handles refresh, OAuth flows, rotation.

## 6. CLI — `gittrix`

A thin wrapper over the library. Three command families.

```bash
# Sessions
gittrix session start --task "<description>" [--ephemeral=<adapter>] [--ttl=<duration>]
gittrix session list [--status=active|expired|all]
gittrix session diff <session-id>
gittrix session log <session-id>
gittrix session evict <session-id>

# Promotion
gittrix promote <session-id> [--strategy=auto|commit|branch|pr|patch] [--branch=<name>]

# Configuration
gittrix config set <key> <value>
gittrix config get <key>
gittrix config list
```

Session metadata lives in `~/.gittrix/` (or platform-equivalent XDG dir). Working directories for ephemeral sessions live under `~/.gittrix/sessions/<session-id>/`.

The CLI does not replace git. Inside a session's working directory, users run normal git commands. Gittrix only operates at session boundaries (start, diff, promote, evict).

## 7. Adapters (v1)

Two-tier model: git-first substrate, forge-optional layers.

Core adapters (substrate-agnostic, ship in v0.1 and v0.2):

| Adapter | Role | Notes |
|---|---|---|
| `@gittrix/adapter-local` | Durable + Ephemeral | Shells out to local git. v0.1 — done. |
| `@gittrix/adapter-git-remote` | Durable + Ephemeral | Generic git remote adapter over HTTPS/SSH. Covers Forgejo, Gitea, Sourcehut, self-hosted GitLab, Codeberg, bare-repo-over-SSH, and anything that speaks git. v0.2 priority. |

`@gittrix/adapter-git-remote` capabilities:

```ts
{
  git: true,
  push: true,
  fetch: true,
  history: true,
  pr: false,
  ttl: false,
  latencyClass: 'regional'
}
```

`git-remote` is the recommended durable adapter when forge-specific features (PR creation, issue linking, CI status) are not required.

Forge-aware adapters (extend `git-remote` with API features, ship as access lands):

| Adapter | Role | Capabilities beyond `git-remote` |
|---|---|---|
| `@gittrix/adapter-github` | Durable | `pr: true` via Octokit |
| `@gittrix/adapter-codestorage` | Durable + Ephemeral | `ttl: true`, native session lifecycle |
| `@gittrix/adapter-cloudflare` | Ephemeral | Cloudflare Artifacts wrapper |
| `@gittrix/adapter-gitfork` | Ephemeral | URL-as-API |
| `@gittrix/adapter-gitlab` | Durable | `pr: true` (MR creation) — when demand emerges |

MVP slice:

- v0.1 ships local only (current state).
- v0.2 priority is `git-remote` (not GitHub).
- v0.3 adds GitHub as a forge-aware layer on top of `git-remote` with PR creation (`pr: true`).

## 8. Tooling and runtime

- Language: TypeScript, strict mode, ESM only
- Runtime: Runtime-agnostic core (Workers, Bun, Node, Deno). Adapters opt into runtime APIs explicitly.
- Dev environment: Bun for install, test, build
- Build: tsup or Bun's bundler. ESM output with `.d.ts` declarations.
- Lint/format: Biome or oxlint
- Test: Bun test or Vitest
- Versioning: Changesets across the monorepo
- Git library: isomorphic-git for cross-runtime adapters, shell-out to git for local-only adapters
- Core dependencies: zero runtime dependencies except nanoid (session IDs)

## 9. Repo structure

```text
gittrix/
├── package.json
├── bun.lockb
├── tsconfig.base.json
├── README.md
├── SPEC.md (this file)
├── packages/
│   ├── core/                    # @gittrix/core
│   ├── cli/                     # gittrix (unscoped)
│   ├── adapter-local/           # @gittrix/adapter-local
│   ├── adapter-github/          # @gittrix/adapter-github
│   ├── adapter-cloudflare/      # @gittrix/adapter-cloudflare
│   ├── adapter-codestorage/     # @gittrix/adapter-codestorage
│   └── adapter-gitfork/         # @gittrix/adapter-gitfork
└── examples/
    └── glib-integration/        # how glib-code wires it up
```

GitHub: cloudboy-jh/gittrix. License: MIT.

## 10. Non-goals (v1)

Explicit, to prevent scope creep:

- Multi-agent sessions. One agent per session. Multi-agent collaboration is out.
- Cross-adapter merge. Direct ephemeral→durable only. No "ephemeral on Cloudflare → intermediate on Code Storage → final on GitHub" chains.
- Conflict resolution UI. Surface conflicts, refuse auto-promote, let consumer handle. No three-way merge logic.
- Real-time collaboration on a single session. Sessions are single-user.
- Multi-tenancy in core. Run multiple gittrix instances if you need isolation.
- Hooks / mutating middleware. Events only.
- Web dashboard / inspector. Library + CLI only. Inspector tool may come later as separate package.
- Replace git. Gittrix lives alongside git, not in place of it.

## 11. Strategic positioning

Gittrix is to git what gh is to GitHub or wrangler is to Cloudflare: a purpose-built CLI and library for a layer that doesn't have one yet. It does not replace existing tools. It adds the missing piece — agent-aware session lifecycle with explicit promotion gates — to a workflow that otherwise still uses normal git.

The consumer-facing surface is built downstream. glib-code is the canonical consumer in v1: a desktop development tool that uses gittrix for storage routing and bento-diffs for diff review. Other tools can adopt gittrix as a library or invoke its CLI without taking a dependency on glib.

The forge substrate is fragmenting fast. Positioning stays durable by being git-first and forge-optional: durable storage is a pluggable target across hosted and self-hosted forges, with GitHub as one option rather than the center of gravity.

Strategic integrations:

- Cloudflare — ephemeral backend via Artifacts, demos their stack at the human-facing layer
- Pierre (Code Storage) — durable + ephemeral backend, demonstrates real product integration of their git infrastructure
- GitFork — ephemeral backend, complementary positioning (their CLI use case + gittrix's session model)
- GitHub — durable backend option; forge-aware features (PR creation) live in a GitHub-specific layer

## 12. Open questions

Marked explicitly so they're not pretended to be resolved:

- Partial accept across binary files. Hunk-level promotion is straightforward for text. For binaries (images, lock files, etc.), accept-or-reject is whole-file only. Document and ship.
- Multi-commit promotion. v1 ships single synthetic commit per promote. Multi-commit (preserving hunk groupings as separate commits on durable) deferred to v1.1 if demand emerges.
- Session resumption across machines. v1 ships single-machine sessions. Resuming a session on a different machine requires the ephemeral backend to be remote (Code Storage, Cloudflare). Document the requirement.
- What happens when the user's local clone diverges mid-session. Local adapter durable, user makes commits in their normal terminal during a gittrix session. Detection at promote time, surface the conflict, refuse auto-promote. Probably fine but worth confirming in implementation.
- Telemetry. Gittrix never phones home in v1. If telemetry is ever added, it's opt-in and clearly documented. Document the never-by-default posture loudly in README.

## 13. Path to v0.1

Order of work:

- Define types (`StorageAdapter`, `Session`, `Ref`, capabilities, errors) — ~half day
- Implement `LocalFsAdapter` + `LocalTmpAdapter` — 1 day
- Implement GitTrix router (overlay reads, ephemeral writes, baseline tracking, basic promote) — 2 days
- Implement eviction daemon — half day
- Implement CLI wrapping the library — 1 day
- Wire into glib-code's existing agent loop — half day
- End-to-end test with a real agent run — half day

One week to a working v0.1 against local-only. `git-remote` adapter is the v0.2 priority after v0.1 fixes (dirty-tree detection on promote, atomic apply cleanup, read-only access for non-active sessions). GitHub and other forge-aware adapters layer on after that as access and demand land. Glib-code consumes `@gittrix/core` from day one, writes zero backend code that isn't gittrix calls.

Spec lives. Decisions are reversible. Ship and learn.

That's the spec. Few things worth flagging before you commit it to the repo:

- The `forAgent()` method on `UserSession` is the structural safety mechanism. It returns a narrowed object with no `promote`. Worth testing this hard — it's the load-bearing claim.
- Section 12 has the actual unresolved stuff. Don't pretend it's resolved during implementation. Update the spec when you decide.
- Section 13's timeline is aggressive. It works if you stay disciplined about scope. The moment you start adding capabilities not in this doc, the timeline slips.
