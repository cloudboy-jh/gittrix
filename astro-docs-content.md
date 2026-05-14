# Gittrix Astro Docs Content Brief

Use this file as the source of truth for updating the Astro docs app. This is intentionally product/API driven, not commit driven. Do not frame the docs around a single commit or changelog entry.

## Product positioning

Gittrix is storage routing for AI coding agents.

It gives each agent task an ephemeral workspace and keeps the durable repo clean until a human promotes accepted changes.

Core message:

- Agents work in throwaway storage by default.
- Durable history only changes through explicit human-facing promotion.
- The agent gets an `AgentSession`, which does not expose `promote()`.
- The user-facing app gets a `UserSession`, which can review, promote, discard, and extend the session.
- Promotion creates clean durable commits from selected session changes instead of replaying agent history.

One-line tagline:

```txt
Storage routing for AI coding agents.
```

Short description:

```txt
Gittrix routes AI agent writes into ephemeral workspaces and promotes only human-approved changes back to durable git storage.
```

## Current package state

Root package:

- `gittrix@0.1.4`
- ESM only
- Bun workspace monorepo
- Repository: `https://github.com/cloudboy-jh/gittrix`
- License: MIT

Published/runtime packages currently represented in the repo:

| Package | Version | Durable | Ephemeral | Current status |
| --- | ---: | --- | --- | --- |
| `@gittrix/core` | `0.1.4` | n/a | n/a | current core router |
| `@gittrix/adapter-local` | `0.1.4` | yes | yes | implemented |
| `@gittrix/adapter-github` | `0.2.0-alpha.2` | yes | no | implemented |
| `@gittrix/adapter-cloudflare-artifacts` | `0.2.0-alpha.2` | yes | yes | implemented |
| `@gittrix/adapter-codestorage` | `0.3.0-alpha.1` | yes | yes | scaffold only; throws unavailable until early access |
| `@gittrix/cli` | `0.1.4` | local only | local only | private package, root binary is `gittrix` |

Important docs correction:

- Do not describe Code Storage as working yet. Its package exists, but both durable and ephemeral adapters throw `ADAPTER_UNAVAILABLE` with `Code Storage adapter pending early access`.
- Do not claim hunk-level promotion is implemented. Current selectors are `all` and `files` only.
- Do not claim PR promotion is wired through `UserSession.promote()`. `GitHubDurableAdapter.openPullRequest()` exists as a direct adapter method, but core promotion currently calls `applyCommit()`.
- Do not claim `session.log()` returns real history. Current core `GitTrixSession.log()` returns an empty array.
- Do not claim agent commits are real git commits through core. Current core `commit()` returns synthetic `ephemeral-${Date.now()}`. Git-backed ephemeral workspaces can still be used as normal local git directories by external tools.

## Installation docs

Recommended install examples:

```bash
bun add @gittrix/core @gittrix/adapter-local
```

```bash
bun add @gittrix/core @gittrix/adapter-github @gittrix/adapter-local
```

```bash
bun add @gittrix/core @gittrix/adapter-cloudflare-artifacts
```

CLI install:

```bash
bun add -g gittrix
```

## Core architecture

Gittrix is built around two adapter interfaces:

- `DurableAdapter` — the source of truth; must be git-capable.
- `EphemeralAdapter` — the agent workspace; may be local, remote, git-backed, or non-git depending on adapter support.

The router is `GitTrix` from `@gittrix/core`.

Current constructor:

```ts
new GitTrix({
  durable,
  ephemeral,
  storeDir,
  defaultEviction,
  evictionSweepIntervalMs,
})
```

`durable` must expose `capabilities().git === true`, or construction throws `CAPABILITY_MISSING`.

Default session store:

```txt
~/.gittrix/sessions
```

Session files are stored under:

```txt
~/.gittrix/sessions/<session-id>/
├── metadata.json
├── .lock
└── workspace/
```

## Session lifecycle

Current lifecycle:

1. Consumer creates `GitTrix` with one durable adapter and one ephemeral adapter.
2. Consumer calls `await gittrix.init()`.
3. Consumer starts a session with `startSession({ task, durablePath?, durableRef?, durableBranch?, eviction? })`.
4. Gittrix records the durable branch head as `baselineSha`.
5. Gittrix initializes an ephemeral workspace from the baseline.
6. The agent receives `session.forAgent()`.
7. Agent reads, writes, deletes, lists, diffs, and commits inside the session API.
8. User-facing app calls `session.diff()` and `session.promote()` with selected files or all touched files.
9. Gittrix checks durable drift against the baseline.
10. If selected files overlap durable changes since baseline, promotion fails with `BASELINE_CONFLICT`.
11. If promotion succeeds, Gittrix applies a synthetic durable commit and marks the session `promoted`.
12. If `untilPromote` is enabled, Gittrix evicts the ephemeral workspace after promotion.

Default eviction policy:

```ts
{
  ttlIdleMs: 4 * 60 * 60 * 1000,
  ttlAbsoluteMs: null,
  untilPromote: true,
  manual: false,
}
```

Default eviction sweep interval:

```ts
5 * 60 * 1000
```

Session states:

```ts
type SessionState = 'active' | 'promoted' | 'discarded' | 'expired'
```

## Session metadata

Current `metadata.json` shape:

```ts
interface SessionMetadata {
  metadataVersion: 1
  id: string
  task: string
  durableRef: string
  durablePath?: string
  durableBranch?: string
  ephemeralRef: string
  ephemeralPath?: string
  baselineSha: string
  workspaceKind?: 'worktree' | 'clone' | 'copy' | 'remote'
  isGitBacked?: boolean
  state: 'active' | 'promoted' | 'discarded' | 'expired'
  createdAt: string
  updatedAt: string
  lastAccessAt: string
  evictionPolicy: {
    ttlIdleMs: number | null
    ttlAbsoluteMs: number | null
    untilPromote: boolean
    manual: boolean
  }
  touchedFiles: string[]
  promote: {
    strategy: 'auto' | 'commit' | 'branch' | 'pr' | 'patch'
    result: { sha: string; branch: string; prUrl?: string } | null
  }
}
```

Mixed remote durable + remote ephemeral sessions may have no `durablePath`, but can still expose a local `ephemeralPath` for agent execution.

Example GitHub durable + Cloudflare ephemeral metadata:

```ts
{
  metadataVersion: 1,
  id: 'sess_abc123',
  task: 'update docs',
  durableRef: 'github://owner/repo#main',
  durableBranch: 'main',
  ephemeralRef: 'cloudflare://default/gittrix-eph-sess_abc123',
  ephemeralPath: '/Users/jack/.gittrix/cf-artifacts-ephemeral/sess_abc123',
  baselineSha: '<durable-head-sha>',
  workspaceKind: 'remote',
  isGitBacked: true,
  state: 'active',
  touchedFiles: [],
  promote: { strategy: 'auto', result: null }
}
```

## Public core API

Current exported session interfaces:

```ts
interface AgentSession {
  read(path: string): Promise<Uint8Array>
  write(path: string, bytes: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  commit(message: string): Promise<string>
  writeAndCommit(opts: { files: Record<string, Uint8Array>; message: string }): Promise<string>
  list(path?: string): Promise<ListEntry[]>
  diff(): Promise<string>
  log(): Promise<CommitEntry[]>
}

interface UserSession extends AgentSession {
  promote(opts: PromoteOpts): Promise<PromoteResult>
  discard(): Promise<void>
  extend(ttlMs: number): Promise<void>
  forAgent(): AgentSession
}
```

The important safety claim is still accurate:

```ts
const agent = session.forAgent()
```

`agent` has no `promote()` method.

Current promotion selectors:

```ts
type PromoteSelector =
  | { mode: 'all' }
  | { mode: 'files'; files: string[] }
```

Current promotion strategies type:

```ts
type PromoteStrategy = 'auto' | 'commit' | 'branch' | 'pr' | 'patch'
```

Implementation note for docs:

- The type includes `auto`, `commit`, `branch`, `pr`, and `patch`.
- Current core implementation passes selected files to the durable adapter's `applyCommit()` on the durable branch. It does not yet implement separate behavior for branch, PR, or patch strategies.

## Basic local usage

Use this as the main quickstart example:

```ts
import { GitTrix } from '@gittrix/core'
import { LocalDurableAdapter, LocalEphemeralAdapter } from '@gittrix/adapter-local'

const gittrix = new GitTrix({
  durable: new LocalDurableAdapter({ path: '/path/to/repo', branch: 'main' }),
  ephemeral: new LocalEphemeralAdapter({ sessionsRootDir: '/tmp/gittrix-sessions' }),
})

await gittrix.init()

const session = await gittrix.startSession({
  task: 'update docs',
  durablePath: '/path/to/repo',
  durableBranch: 'main',
})

const agent = session.forAgent()

await agent.write('README.md', new TextEncoder().encode('# Updated\n'))
await agent.commit('agent draft')

const diff = await session.diff()
console.log(diff)

await session.promote({
  selector: { mode: 'all' },
  message: 'docs: update readme',
})

await gittrix.close()
```

## GitHub durable adapter docs

Use GitHub when promoted changes should land in a GitHub repository.

Import:

```ts
import { GitHubDurableAdapter } from '@gittrix/adapter-github'
```

Options:

```ts
interface GitHubDurableAdapterOptions {
  owner: string
  repo: string
  branch?: string
  token?: string
  tokenProvider?: () => Promise<string> | string
  mirrorRoot?: string
  remoteUrl?: string
  apiBaseUrl?: string
  gitUserName?: string
  gitUserEmail?: string
}
```

Capabilities:

```ts
{ git: true, push: true, fetch: true, history: true, ttl: false, latencyClass: 'regional' }
```

How it works:

- Maintains a local mirror under `~/.gittrix/github-mirrors` by default.
- Clones/fetches the GitHub repo.
- Reads files and lists trees from local git objects.
- Applies promoted files as a commit in the mirror.
- Pushes `HEAD` to `refs/heads/<branch>`.
- Can open a GitHub PR via `openPullRequest()` as a direct adapter method.

Usage with local ephemeral workspaces:

```ts
import { GitTrix } from '@gittrix/core'
import { GitHubDurableAdapter } from '@gittrix/adapter-github'
import { LocalEphemeralAdapter } from '@gittrix/adapter-local'

const durable = new GitHubDurableAdapter({
  owner: 'acme',
  repo: 'app',
  branch: 'main',
  token: process.env.GITHUB_TOKEN,
})

const gittrix = new GitTrix({
  durable,
  ephemeral: new LocalEphemeralAdapter({ sessionsRootDir: '/tmp/gittrix-sessions' }),
})
```

GitHub token notes:

- Token is optional for public clone/read if the remote allows it.
- Token is required for authenticated push and PR creation.
- Required GitHub permissions for full behavior: contents read/write; pull requests read/write for `openPullRequest()`.

Direct PR example:

```ts
const result = await durable.applyCommit({
  branch: 'gittrix/update-docs',
  message: 'docs: update readme',
  files: {
    'README.md': new TextEncoder().encode('# Updated\n'),
  },
})

const pr = await durable.openPullRequest({
  title: 'Update docs',
  head: result.branch,
  base: 'main',
  body: 'Promoted from a Gittrix session.',
})

console.log(pr.url)
```

## Cloudflare Artifacts adapter docs

Package:

```txt
@gittrix/adapter-cloudflare-artifacts@0.2.0-alpha.2
```

Imports:

```ts
import {
  CloudflareArtifactsDurableAdapter,
  CloudflareArtifactsEphemeralAdapter,
} from '@gittrix/adapter-cloudflare-artifacts'
```

Durable options:

```ts
interface CloudflareArtifactsDurableOptions {
  accountId: string
  apiToken: string
  namespace?: string
  repoName: string
  branch?: string
  mirrorRoot?: string
}
```

Ephemeral options:

```ts
interface CloudflareArtifactsEphemeralOptions {
  accountId: string
  apiToken: string
  namespace?: string
  workingRoot?: string
}
```

Cloudflare durable capabilities:

```ts
{ git: true, push: true, fetch: true, history: true, ttl: false, latencyClass: 'regional' }
```

Cloudflare ephemeral capabilities:

```ts
{ git: true, push: false, fetch: false, history: false, ttl: true, latencyClass: 'regional' }
```

Cloudflare durable behavior:

- Creates or fetches an Artifacts repo by `repoName`.
- Mints a repo token through the Artifacts API.
- Maintains a local mirror under `~/.gittrix/durable-mirrors` by default.
- Reads durable content from git objects.
- Applies promoted files as a commit and pushes to the selected branch.

Cloudflare ephemeral behavior:

- Creates one Artifacts repo per session named `gittrix-eph-<session-id>`.
- Mints a repo token.
- Clones the repo locally under `~/.gittrix/cf-artifacts-ephemeral/<session-id>` by default.
- Falls back to `git init` if clone fails.
- Materializes the durable baseline into the local workspace when a durable adapter is provided.
- Commits a `gittrix baseline <sha>` commit, or an empty baseline commit if needed.
- Tracks API-written files, deleted files, unstaged changes, staged changes, and untracked files.
- Excludes `.git`, `.gittrix`, `.glib`, and `.gittrix-touched.json` from session changes.
- Destroys both the local workspace and remote ephemeral repo on eviction.

Cloudflare durable + ephemeral usage:

```ts
import { GitTrix } from '@gittrix/core'
import {
  CloudflareArtifactsDurableAdapter,
  CloudflareArtifactsEphemeralAdapter,
} from '@gittrix/adapter-cloudflare-artifacts'

const gittrix = new GitTrix({
  durable: new CloudflareArtifactsDurableAdapter({
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
    repoName: 'app',
    branch: 'main',
  }),
  ephemeral: new CloudflareArtifactsEphemeralAdapter({
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
  }),
})
```

GitHub durable + Cloudflare ephemeral usage:

```ts
import { GitTrix } from '@gittrix/core'
import { GitHubDurableAdapter } from '@gittrix/adapter-github'
import { CloudflareArtifactsEphemeralAdapter } from '@gittrix/adapter-cloudflare-artifacts'

const gittrix = new GitTrix({
  durable: new GitHubDurableAdapter({
    owner: 'acme',
    repo: 'app',
    branch: 'main',
    token: process.env.GITHUB_TOKEN,
  }),
  ephemeral: new CloudflareArtifactsEphemeralAdapter({
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
  }),
})
```

Key mixed-adapter message:

```txt
GitHub can stay the durable source of truth while Cloudflare Artifacts provides the isolated git-backed workspace where agents run.
```

## Local adapter docs

Package:

```txt
@gittrix/adapter-local@0.1.4
```

Imports:

```ts
import { LocalDurableAdapter, LocalEphemeralAdapter } from '@gittrix/adapter-local'
```

Durable options:

```ts
interface LocalDurableAdapterOptions {
  path: string
  branch?: string
}
```

Ephemeral options:

```ts
interface LocalEphemeralAdapterOptions {
  sessionsRootDir: string
}
```

Local durable capabilities:

```ts
{ git: true, push: false, fetch: false, history: true, ttl: false, latencyClass: 'local' }
```

Local ephemeral capabilities:

```ts
{ git: true, push: false, fetch: false, history: true, ttl: false, latencyClass: 'local' }
```

Local ephemeral behavior:

- Creates a `git worktree` at `<sessionsRootDir>/<session-id>/workspace` when possible.
- Falls back to a clone checked out at the baseline SHA.
- Tracks API writes and git working-tree changes.
- Excludes `.git`, `.gittrix-touched.json`, and `.glib` from touched files.
- Removes worktrees cleanly on destroy and prunes stale worktree metadata best-effort.

Deprecated note:

```ts
LocalFsAdapter
```

is removed and throws immediately. Docs should point to `LocalDurableAdapter` and `LocalEphemeralAdapter` instead.

## Code Storage adapter docs

Package:

```txt
@gittrix/adapter-codestorage@0.3.0-alpha.1
```

Current status:

```txt
Scaffolded, awaiting Code Storage early access.
```

Docs should say:

- The package exists.
- The durable and ephemeral adapter classes exist.
- The capabilities are declared as git/push/fetch/history/ttl capable with edge latency.
- Every operation currently throws `ADAPTER_UNAVAILABLE`.
- It is not ready for production use.

Classes:

```ts
CodeStorageDurableAdapter
CodeStorageEphemeralAdapter
```

Options:

```ts
interface CodeStorageDurableOptions {
  namespace: string
  repo: string
  branch?: string
}

interface CodeStorageEphemeralOptions {
  namespace: string
}
```

## CLI docs

The root package exposes a `gittrix` binary:

```json
{
  "bin": {
    "gittrix": "./packages/cli/dist/index.js"
  }
}
```

Current CLI scope:

- Uses local durable adapter pointed at `process.cwd()`.
- Uses local ephemeral adapter under `~/.gittrix/sessions`.
- Supports JSON mode with `--json` or `-j`.
- Not currently wired for GitHub or Cloudflare configuration.

Commands:

```bash
gittrix session start "<task>" <durable-path> [branch]
gittrix s start "<task>" <durable-path> [branch]

gittrix session list [active|promoted|discarded|expired|all]
gittrix session diff <session-id>
gittrix session log <session-id>
gittrix session evict <session-id>

gittrix promote <session-id> [--files=a,b] [-m "msg"]
gittrix p <session-id> [--files=a,b] [-m "msg"]
```

Flags:

```txt
--json, -j
--task, -t
--durable, -d
--branch, -b
--message, -m
--files, -f
--strategy, -s
```

JSON success shape:

```json
{ "ok": true, "data": {} }
```

JSON error shape:

```json
{ "ok": false, "error": { "code": "UNKNOWN", "message": "..." } }
```

For `GittrixError`, the stable error code is returned.

## Diff and promotion docs

Current diff behavior:

- Computes diffs from `ephemeral.touchedFiles(sessionId)`.
- Reads baseline content from durable at `baselineSha`.
- Reads current content from ephemeral if the file exists.
- Missing ephemeral file means deletion.
- Text files use unified patches via the `diff` package.
- Binary files are reported as:

```txt
Binary files a/<path> and b/<path> differ
```

Current promotion behavior:

- `selector: { mode: 'all' }` promotes all touched files.
- `selector: { mode: 'files', files: [...] }` promotes selected touched files only.
- Empty selection fails with `PROMOTE_FAILED` at stage `staging`.
- Gittrix reads current durable HEAD before applying.
- If durable HEAD changed since baseline, Gittrix checks changed file paths.
- If durable-changed files overlap selected files, Gittrix throws `BASELINE_CONFLICT`.
- Non-overlapping durable drift does not block promotion.
- Selected files are sent to `durable.applyCommit()` as `Record<string, Uint8Array | null>`.
- `null` means delete the file on durable.
- Default commit message is `gittrix: <task>`, or `gittrix: promote session <session-id>` if task is blank.

Baseline conflict error shape:

```ts
class BaselineConflictError extends GittrixError {
  code: 'BASELINE_CONFLICT'
  conflictingFiles: string[]
  durableSha: string
  baselineSha: string
}
```

## Events docs

`GitTrix` extends Node's `EventEmitter`.

Current emitted events:

```ts
gittrix.on('session.start', ({ sessionId }) => {})
gittrix.on('session.write', ({ sessionId, path, op }) => {})
gittrix.on('session.commit', ({ sessionId, sha }) => {})
gittrix.on('session.promote', ({ sessionId, result }) => {})
gittrix.on('session.evict', ({ sessionId }) => {})
```

Notes:

- There is no middleware chain.
- Events are observability only.
- `session.write` uses `op: 'delete'` for deletes; regular writes omit `op`.

## Errors docs

Current stable error codes:

```ts
ADAPTER_UNAVAILABLE
AUTH_FAILED
CAPABILITY_MISSING
SESSION_NOT_FOUND
SESSION_EXPIRED
BASELINE_CONFLICT
PROMOTE_FAILED
WRITE_REJECTED
EVICTION_RACE
METADATA_VERSION_UNSUPPORTED
```

Error classes:

```ts
GittrixError
AdapterUnavailableError
AuthError
CapabilityMissingError
SessionNotFoundError
SessionExpiredError
BaselineConflictError
PromoteFailedError
WriteRejectedError
EvictionRaceError
MetadataVersionError
```

## Ref URI docs

Current ref union:

```ts
type Ref =
  | { type: 'local'; path: string; branch?: string }
  | { type: 'github'; owner: string; repo: string; branch?: string }
  | { type: 'codestorage'; namespace: string; repo: string; branch?: string }
  | { type: 'cloudflare'; namespace: string; key: string }
  | { type: 'gitfork'; slug: string }
```

Current URI formats:

```txt
local:///abs/path#branch
github://owner/repo#branch
codestorage://namespace/repo#branch
cloudflare://namespace/key
gitfork://slug
```

Windows local paths are normalized to:

```txt
local:///C:/path/to/repo#main
```

## Capability docs

Current capability shape:

```ts
interface AdapterCapabilities {
  git: boolean
  push: boolean
  fetch: boolean
  history: boolean
  ttl: boolean
  maxBlobSize?: number
  latencyClass: 'local' | 'edge' | 'regional'
}
```

Current ephemeral workspace info shape:

```ts
interface EphemeralWorkspaceInfo {
  localPath?: string
  ephemeralRef?: string
  isGitBacked: boolean
  supportsShellCwd: boolean
  supportsGitCommands: boolean
  supportsPromote: boolean
  workspaceKind: 'worktree' | 'clone' | 'copy' | 'remote'
}
```

## Development docs

Repo setup:

```bash
bun install
bun run build
bun run typecheck
bun run test
```

Harness commands:

```bash
bun run testharness --
bun run testharness -- --integration
bun run testharness -- --all
bun run testharness -- --typecheck
```

Cloudflare integration env vars:

```txt
CF_ACCOUNT_ID
CF_API_TOKEN
CF_ARTIFACTS_NAMESPACE
CF_ARTIFACTS_REPO
CF_ARTIFACTS_BRANCH optional, default main
```

Root scripts:

```json
{
  "build": "build all packages and harness",
  "typecheck": "build/typecheck packages and harness",
  "test": "run package test suites",
  "testharness": "run harness package"
}
```

Runtime/dependency notes:

- TypeScript strict ESM packages.
- Bun is the package manager and test runner.
- Core runtime dependencies are `diff` and `nanoid`.
- Local/GitHub/Cloudflare adapters shell out to `git`.

## Suggested Astro docs structure

Use these pages/sections:

```txt
/
  - Product positioning
  - Short example
  - Adapter matrix
  - Safety claim: AgentSession has no promote

/quickstart
  - Install
  - Local durable + local ephemeral example
  - Start, write, diff, promote

/concepts/sessions
  - Session lifecycle
  - Metadata
  - Eviction
  - AgentSession vs UserSession

/concepts/promotion
  - Selectors: all/files
  - Baseline conflict detection
  - Diff behavior
  - Current strategy limitations

/adapters/local
  - Local durable
  - Local ephemeral
  - Worktree/clone behavior

/adapters/github
  - Durable adapter
  - Mirror behavior
  - Token/provider options
  - Direct PR API

/adapters/cloudflare-artifacts
  - Durable adapter
  - Ephemeral adapter
  - GitHub durable + Cloudflare ephemeral flow

/adapters/codestorage
  - Scaffolded only
  - Not currently usable

/cli
  - Commands
  - Flags
  - JSON output
  - Local-only limitation

/reference/core-api
  - GitTrix options
  - Session interfaces
  - Types
  - Events
  - Errors

/development
  - Bun commands
  - Harness
  - Integration env vars
```

## Copy blocks for landing page

Hero title:

```txt
Ephemeral workspaces for AI coding agents.
```

Hero body:

```txt
Gittrix routes agent writes away from durable repo history and into isolated workspaces. Humans review the diff and promote only the accepted changes back to durable git storage.
```

Feature cards:

```txt
Agent-safe by construction
Agents receive an AgentSession with no promote method. Durable writes are only available through the user-facing session.

Adapter-based storage routing
Use local git, GitHub, Cloudflare Artifacts, or any compatible durable/ephemeral adapter pair.

Baseline-aware promotion
Gittrix records the durable baseline at session start and refuses to overwrite overlapping durable changes during promotion.

Normal git workspaces
Git-backed ephemeral adapters expose local workspaces where tools can run normal git commands.
```

Adapter matrix copy:

```txt
Local is fully implemented for durable and ephemeral workflows. GitHub is implemented as a durable adapter. Cloudflare Artifacts is implemented for both durable repositories and ephemeral session workspaces. Code Storage is scaffolded but unavailable pending early access.
```

## Current limitations to document honestly

- Core promotion supports all-files and selected-files promotion, not hunk-level promotion.
- Core promotion records strategy but does not yet branch, open PRs, or emit patches from `session.promote()`.
- GitHub PR creation exists as `GitHubDurableAdapter.openPullRequest()`, not as automatic `UserSession.promote({ strategy: 'pr' })` behavior.
- `session.log()` currently returns `[]`.
- `session.commit()` currently returns a synthetic ephemeral ID, not a real commit SHA.
- CLI is local-adapter only right now.
- Code Storage adapter is not usable yet.
- The core uses Node APIs today (`EventEmitter`, filesystem-backed session store), so avoid claiming full Workers/Deno runtime support for the current implementation.
