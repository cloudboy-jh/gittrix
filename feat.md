# GitTrix v0.2: Interface Split + adapter-cloudflare-artifacts

Two-part v0.2 release. Do them in order. Do not skip ahead.

## Context

GitTrix v0.1 ships with `@gittrix/core`, `@gittrix/adapter-local`, and a CLI. The adapter interface today (`LocalSessionAdapter`) is one fat interface that mixes durable and ephemeral operations and assumes git on both sides. That works for local-on-both-sides but doesn't generalize.

v0.2 splits the interface and adds Cloudflare Artifacts as the first non-local adapter. After v0.2, the adapter selection model is:

- **Durable** = where final code lives. Always git-capable. Examples: local, git-remote, GitHub, Code Storage, Cloudflare Artifacts.
- **Ephemeral** = where agent work happens. Doesn't have to be git-capable, but can be. Examples: local, Cloudflare Artifacts, GitFork, Code Storage.

A user picks one of each. "Local durable + Cloudflare Artifacts ephemeral." "Cloudflare Artifacts durable + Cloudflare Artifacts ephemeral." Etc.

This v0.2 ships:
- Interface split (breaking change to core)
- `LocalFsAdapter` updated to implement both new interfaces
- New `@gittrix/adapter-cloudflare-artifacts` package implementing both interfaces
- Diff computation moved from adapters into core

## Architecture decisions (locked)

- **Interface names**: `DurableAdapter` and `EphemeralAdapter`
- **One package can export both adapter types**: `@gittrix/adapter-local` exports `LocalDurableAdapter` and `LocalEphemeralAdapter`. Same pattern for cloudflare-artifacts.
- **Durable mirrors for non-local durables**: GitTrix-owned mirror clones live under `~/.gittrix/durable-mirrors/<sha256-of-remote-url>/`. Real bare/full git repos. Lazy-fetched on first use, GC'd after N days idle. Markered as GitTrix-owned via `.gittrix-mirror` file at repo root.
- **Diff computation lives in core**, not adapters. Core asks ephemeral for touched files + bytes, asks durable for baseline bytes at baseline sha, computes unified diff using the `diff` npm package. Binary detection in core (null-byte check in first 8KB), emits "Binary files differ" like git does.
- **Cloudflare Artifacts API endpoint**: `https://api.cloudflare.com/client/v4/accounts/{accountId}/artifacts/namespaces/{namespace}/repos`. NOT `artifacts.cloudflare.net` — that endpoint in the public docs is wrong.

## Part 1: Interface split

### Goals

- Split `LocalSessionAdapter` into `DurableAdapter` + `EphemeralAdapter`
- Move diff computation from adapter into core
- Update `LocalFsAdapter` to implement both new interfaces (split into `LocalDurableAdapter` + `LocalEphemeralAdapter`)
- Update core router to consume both adapter types
- Update CLI to reflect new adapter wiring
- Tag as v0.2.0-alpha to verify nothing regressed before adapter-cloudflare-artifacts

### Steps

1. In `packages/core/src/types.ts`, add the new interfaces:

```ts
export interface DurableAdapter {
  capabilities(): AdapterCapabilities  // git: true required
  getHead(branch: string): Promise<string>
  readAtSha(sha: string, path: string): Promise<Uint8Array>
  listAtSha(sha: string, path?: string): Promise<ListEntry[]>
  changedFilesBetween(fromSha: string, toSha: string): Promise<string[]>
  applyCommit(opts: { files: Record<string, Uint8Array | null>; message: string; branch?: string }): Promise<{ sha: string; branch: string }>
}

export interface EphemeralAdapter {
  capabilities(): AdapterCapabilities  // git optional
  initWorkspace(sessionId: string, baseline: { durableRef: string; sha: string }): Promise<void>
  read(sessionId: string, path: string): Promise<Uint8Array>
  write(sessionId: string, path: string, bytes: Uint8Array): Promise<void>
  delete(sessionId: string, path: string): Promise<void>
  exists(sessionId: string, path: string): Promise<boolean>
  list(sessionId: string, path?: string): Promise<ListEntry[]>
  touchedFiles(sessionId: string): Promise<string[]>
  destroy(sessionId: string): Promise<void>
}
```

   `applyCommit` takes `Record<string, Uint8Array | null>` where `null` indicates deletion.

   Mark the existing `LocalSessionAdapter` as `@deprecated` in JSDoc but keep it for one release for any external consumers. Internal code switches to the new interfaces.

2. In `packages/core/src/gittrix.ts`, update `GitTrixOptions` to take both adapters:

```ts
export interface GitTrixOptions {
  durable: DurableAdapter
  ephemeral: EphemeralAdapter
  storeDir?: string
  defaultEviction?: Partial<EvictionPolicy>
  evictionSweepIntervalMs?: number
}
```

   Update the constructor to validate `durable.capabilities().git === true` and throw `CapabilityMissingError` otherwise.

3. Add diff computation to core. Create `packages/core/src/diff.ts`:

```ts
import { createPatch } from 'diff'

export async function computeDiff(opts: {
  ephemeral: EphemeralAdapter
  durable: DurableAdapter
  sessionId: string
  baselineSha: string
}): Promise<string>
```

   - Calls `ephemeral.touchedFiles(sessionId)` to get the list
   - For each file, reads ephemeral bytes (or null if deleted) and durable bytes at baselineSha
   - Detects binary files: scan first 8192 bytes for null byte, treat as binary if found
   - For text files: use `createPatch(filename, baseline, current)` from the `diff` package
   - For binary files: emit `Binary files a/<path> and b/<path> differ`
   - Concatenate all per-file diffs into a single unified-diff string
   - Returns empty string if no touched files

4. Add `diff` to `packages/core/package.json` dependencies. Pin a known-good version.

5. Update `GitTrixSession.diff()` in `gittrix.ts` to call `computeDiff` instead of `adapter.diffEphemeral()`. Same for `log()` — if it stays useful, route through `ephemeral.list()` or similar; if not, deprecate it on `UserSession` (it's mostly a debugging affordance).

6. Update `GitTrixSession.promote()` to:
   - Get touched files from `ephemeral.touchedFiles(sessionId)`
   - For each file, read bytes from ephemeral (null if deleted)
   - Call `durable.applyCommit({ files, message, branch })`
   - Same baseline conflict detection logic as today, but now via `durable.changedFilesBetween()`

7. Update read/write/list/commit operations on `GitTrixSession` to route through the appropriate adapter. The overlay-read pattern (check ephemeral first, fall through to durable at baseline) lives in core, not in adapter.

8. In `packages/adapter-local/src/index.ts`:
   - Replace the single `LocalFsAdapter` class with two:
     - `LocalDurableAdapter` implements `DurableAdapter` — operates on a real git working tree at a configured path. `applyCommit` writes files, runs `git add` + `git commit`, returns sha and branch.
     - `LocalEphemeralAdapter` implements `EphemeralAdapter` — operates on a tmp workspace under configured `sessionsRootDir`. `initWorkspace` creates the directory but does NOT clone (overlay reads handle baseline); just mkdir. `touchedFiles` tracks writes/deletes via an in-memory + on-disk manifest under `<sessionRoot>/.gittrix-touched.json`.
   - Remove `LocalFsAdapter` entirely. If you need backward compat, export it as a deprecated alias that combines both.
   - The `runGit` helper stays.

9. Update `packages/cli/src/index.ts`:
   - `gittrix session start` now wires both adapters explicitly (or uses sensible defaults). For v0.2 alpha, default to `LocalDurableAdapter({ path: durablePath })` + `LocalEphemeralAdapter({ sessionsRootDir })`.
   - CLI flags stay the same for end users.

10. Run `bun run build` and `bun run typecheck` from repo root. Fix all type errors.

11. Run `bun run test`. Update smoke tests to import the new types.

### Acceptance

- `bun run build` succeeds
- `bun run typecheck` succeeds
- CLI smoke test: `gittrix session start "test" /path/to/repo` creates a session, ephemeral path exists, baseline sha captured
- CLI smoke test: write a file in the ephemeral path, run `gittrix session diff <id>` — diff returns
- CLI smoke test: `gittrix promote <id>` creates a commit on the durable repo
- Tag as `v0.2.0-alpha.1`. Do not publish to npm yet.

## Part 2: adapter-cloudflare-artifacts

### Goals

- New package `@gittrix/adapter-cloudflare-artifacts`
- Exports `CloudflareArtifactsDurableAdapter` and `CloudflareArtifactsEphemeralAdapter`
- Both use Cloudflare Artifacts API as the backing store
- Durable adapter uses the mirror model (clone Artifacts remote into local mirror, all git ops local, push back)
- Ephemeral adapter uses Artifacts repos as ephemeral workspaces with TTL handled via direct API + local commit metadata

### Steps

1. Create `packages/adapter-cloudflare-artifacts/`:
   - `package.json` — depends on `@gittrix/core`, no other runtime deps. Uses `node:fetch` (or `undici` if needed).
   - `tsconfig.json` — match the other adapters
   - `src/index.ts` — exports both adapter classes
   - `src/api.ts` — thin wrapper around the Artifacts REST API
   - `src/run-git.ts` — copy from adapter-local, same shell-out pattern

2. Add the package to root `package.json` workspaces and `bun.lock`.

3. Implement `src/api.ts`:

```ts
export interface ArtifactsClientOptions {
  accountId: string
  apiToken: string
  namespace: string  // default 'default'
}

export class ArtifactsClient {
  constructor(opts: ArtifactsClientOptions) {}
  
  async createRepo(name: string): Promise<{ id: string; remote: string; token: string; expires_at: string }>
  async getRepo(name: string): Promise<{ id: string; name: string; remote: string; default_branch: string }>
  async deleteRepo(name: string): Promise<void>
  async mintToken(repoName: string): Promise<{ token: string; expires_at: string }>
}
```

   Base URL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/artifacts/namespaces/${namespace}`. NOT `artifacts.cloudflare.net`.

   All requests use `Authorization: Bearer ${apiToken}`. Throw `AuthError` on 401/403, throw a typed error including the Cloudflare error code on other failures.

4. Implement `CloudflareArtifactsDurableAdapter`:

```ts
export interface CloudflareArtifactsDurableOptions {
  accountId: string
  apiToken: string
  namespace?: string  // default 'default'
  repoName: string
  branch?: string  // default 'main'
  mirrorRoot?: string  // default ~/.gittrix/durable-mirrors
}

export class CloudflareArtifactsDurableAdapter implements DurableAdapter
```

   - On first use, ensure the mirror exists. Mirror path is `${mirrorRoot}/${sha256(remoteUrl).slice(0,16)}/`. If mirror doesn't exist, fetch repo metadata, mint a fresh token, `git clone` the remote with `http.extraHeader=Authorization: Bearer <token>` into the mirror path. Write `.gittrix-mirror` marker file.
   - Before any read or applyCommit, `git fetch` to refresh the mirror (with a short cache to avoid fetch-per-call — 30s default).
   - `getHead`: `git rev-parse <branch>` in the mirror.
   - `readAtSha` / `listAtSha`: `git show` / `git ls-tree` in the mirror, same pattern as LocalDurableAdapter.
   - `changedFilesBetween`: `git diff --name-only <from>...<to>` in the mirror.
   - `applyCommit`: write files to mirror working tree, `git add`, `git commit`, mint a fresh push token, `git push origin <branch>` with the token in `http.extraHeader`. Return sha + branch.
   - Token refresh: tokens expire. Mint a new one before each push/fetch. Cache tokens with a small TTL margin (refresh 5 min before expiry).

5. Implement `CloudflareArtifactsEphemeralAdapter`:

```ts
export interface CloudflareArtifactsEphemeralOptions {
  accountId: string
  apiToken: string
  namespace?: string  // default 'default'
  workingRoot?: string  // default ~/.gittrix/cf-artifacts-ephemeral
}

export class CloudflareArtifactsEphemeralAdapter implements EphemeralAdapter
```

   - Each session gets its own Artifacts repo named `gittrix-eph-${sessionId}`. On `initWorkspace`, create the repo via `ArtifactsClient.createRepo`, then `git clone` it into `${workingRoot}/${sessionId}/`. The local clone is a real git working tree where reads/writes happen.
   - `read` / `write` / `delete` / `exists` / `list`: operate on the local working tree under `${workingRoot}/${sessionId}/`.
   - `touchedFiles`: track via `.gittrix-touched.json` in `${workingRoot}/${sessionId}/.gittrix/` (NOT inside the working tree git repo — keep it out of `git add`). Update on every write/delete.
   - `destroy`: delete the local working tree, then call `ArtifactsClient.deleteRepo` to release the Artifacts repo.
   - Important: pushes to the Artifacts repo are not required for the ephemeral model — the agent's working state lives locally, and core handles diff/promote by reading from `read()` directly. Pushing to Artifacts only matters if you need session persistence across machines, which is out of scope for v0.2.

   Wait — reconsider. The whole point of using Artifacts as ephemeral is the network-backed persistence. Push to Artifacts on each commit so the session state lives there, not locally. The local clone is a working copy. On `destroy`, the local clone is torn down and the Artifacts repo is deleted.

   - On `write`, write to local working tree. Don't push (would be too chatty).
   - Add `commit(sessionId, message)` as an internal method: `git add`, `git commit`, `git push origin main` with minted token.
   - Core can call `commit` periodically or core leaves it to the adapter's discretion. For v0.2, commit-on-promote is sufficient — at promote time, run an internal commit to flush state to Artifacts, then read from it.

   Actually simplest: don't push at all in v0.2. The ephemeral adapter just uses the Artifacts repo as a created-but-unused remote. The local working tree is the real ephemeral state. v0.3 can add network persistence when there's a clear use case.

   **Final v0.2 decision**: ephemeral adapter creates an Artifacts repo, clones it locally, operates on local clone. Push to Artifacts is deferred. `destroy` deletes both. This gives us the API integration validation without committing to a sync model.

6. Add `LocalEphemeralAdapter`-compatible touched-files tracking. Same pattern: `.gittrix-touched.json` updated on every write/delete.

7. Configuration: how does the user provide credentials?
   - Adapter constructor takes `accountId` and `apiToken` directly. No env var lookups inside the adapter — that's the consumer's job (CLI, glib-code, etc.).
   - Document in the package README: required Cloudflare API token permissions are `Account / Artifacts / Edit`.

8. Testing:
   - Unit tests with mocked `ArtifactsClient` for the adapter logic
   - Integration test (gated behind env var like `GITTRIX_TEST_CF_ACCOUNT_ID` and `GITTRIX_TEST_CF_API_TOKEN`) that hits the real API: create repo, push commit, read back, delete repo. Skip if env vars absent.

9. Update root `package.json` to include the new package in build/test/typecheck scripts.

10. Run `bun run build && bun run typecheck && bun run test`. All pass.

### Acceptance

- New package compiles and typechecks
- Integration test passes against real Cloudflare Artifacts API
- Both adapters implement their respective interfaces fully
- Mirror caching works — second call to `getHead` doesn't re-fetch

## Documentation updates

After Parts 1-2 are done, update these docs:

### `SPEC.md`

- Section 4.3 (Adapters): replace `git-remote` priority with cloudflare-artifacts as the v0.2 ephemeral target. `git-remote` becomes v0.3.
- Section 7 (Adapters v1): update the table:
  - Add `@gittrix/adapter-cloudflare-artifacts` (Durable + Ephemeral) — shipped v0.2
  - `@gittrix/adapter-git-remote` — moved to v0.3
- Section 13 (Path to v0.1): update with v0.2 done state. Add a v0.2 → v0.3 plan paragraph that lists git-remote, Code Storage adapter, and Cloudflare Artifacts hosted-mode bridge as the v0.3 work.
- Section 5.1 (Library API example): update to show `durable: ...` and `ephemeral: ...` separately, not the single-adapter pattern.

### `README.md`

- Update the "Current status" section: v0.2 ships interface split + cloudflare-artifacts adapter
- Update the "Storage options" mermaid diagram: cloudflare-artifacts is now ✅ Available, not 🛠️ Next up

### Add `Docs/migration-v0.2.md` (new file)

- Breaking change notice: `LocalSessionAdapter` is split into `DurableAdapter` + `EphemeralAdapter`
- Migration example: before/after code for consumers
- Note that `LocalFsAdapter` is removed; use `LocalDurableAdapter` + `LocalEphemeralAdapter`
- Diff API: `session.diff()` still returns string, but the work happens in core now — no behavioral change for consumers

## Verification

- `bun run build` from repo root succeeds
- `bun run typecheck` from repo root succeeds
- `bun run test` from repo root succeeds (smoke + integration where credentials available)
- Manual: full local round-trip works (`gittrix session start` → write file → diff → promote)
- Manual: full Cloudflare Artifacts round-trip works (create CF-backed session, write file, diff, promote — both with CF as durable AND with CF as ephemeral with local durable)

## Constraints

- Do not modify the CLI's user-facing flag shape unless required by the interface split
- Do not add dependencies beyond `diff` (in core) and what's needed for adapter-cloudflare-artifacts (no SDK if possible — direct fetch is fine)
- Do not implement adapter-git-remote in this pass — it's v0.3
- Do not implement Code Storage adapter — it's v0.3
- Do not push to npm until v0.2.0 final after both parts are done and verified
- If the Cloudflare Artifacts API behavior differs from what this doc assumes (different endpoint shapes, missing operations, auth quirks), stop and report — do NOT improvise
- The ephemeral adapter does NOT push to Artifacts in v0.2. Local working tree is the ephemeral state. Network sync is v0.3 work if there's demand.

Stop when all of the above is done. Report which files changed, any spec sections that needed reframing beyond what was specified, and any Cloudflare API surprises.