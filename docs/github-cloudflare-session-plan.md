# GitHub Durable + Cloudflare Artifacts Ephemeral Plan

## Current State

- Local GitTrix sessions now use git-backed ephemeral workspaces.
- Local ephemeral workspaces default to detached git worktrees with clone fallback.
- GitHub durable adapter exists and supports git history, reads, commits, pushes, and pull request creation.
- GitHub auth is currently token/token-provider based only.
- Cloudflare Artifacts durable adapter exists and supports artifact-backed git repos through a local mirror.
- Cloudflare Artifacts ephemeral adapter exists, but is not yet aligned with the new reliable-session workspace contract.

## Target Outcome

Support this glib-code configuration end-to-end:

```txt
durable: GitHub
ephemeral: Cloudflare Artifacts
```

Agents should receive a git-aware `ephemeralPath`, work inside that ephemeral workspace, and promote accepted changes back to GitHub using GitTrix baseline/conflict rules.

## Required Work

### 1. Generalize session metadata beyond local durable repos

Extend `startSession()` and stored metadata so non-local durable adapters can provide accurate durable identity without requiring `durablePath`.

Required metadata:

```ts
type UserSession = {
  id: string;
  durableRef: string;
  durablePath?: string;
  durableBranch: string;
  ephemeralRef: string;
  ephemeralPath?: string;
  baselineSha: string;
  workspaceKind: "worktree" | "clone" | "copy" | "remote";
  isGitBacked: boolean;
};
```

### 2. Add adapter capability metadata as a first-class API

Adapters should expose workspace capability metadata instead of relying only on generic git/fetch/push booleans.

```ts
type EphemeralWorkspaceCapabilities = {
  localPath?: string;
  isGitBacked: boolean;
  supportsShellCwd: boolean;
  supportsGitCommands: boolean;
  supportsPromote: boolean;
  workspaceKind: "worktree" | "clone" | "copy" | "remote";
};
```

glib-code should use this metadata to decide whether a session can be used as an agent cwd.

### 3. Upgrade Cloudflare Artifacts ephemeral hydration

Cloudflare ephemeral must hydrate from the durable baseline instead of starting empty.

Expected flow:

1. Create Cloudflare ephemeral artifact repo for the session.
2. Clone it to a local `ephemeralPath`.
3. Materialize the durable baseline tree into that repo.
4. Commit or checkout the baseline so git commands work against `baselineSha` semantics.
5. Return:

```ts
{
  localPath: ephemeralPath,
  isGitBacked: true,
  supportsShellCwd: true,
  supportsGitCommands: true,
  supportsPromote: true,
  workspaceKind: "remote"
}
```

### 4. Track Cloudflare ephemeral git changes correctly

Cloudflare ephemeral should detect the same change classes as local ephemeral:

- API-written files
- deleted files
- unstaged workspace changes
- staged changes
- untracked files

Exclude session internals:

- `.git`
- `.gittrix`
- `.glib`
- Cloudflare/GitTrix metadata

### 5. Preserve promote semantics across GitHub durable

Promote must continue comparing:

- GitHub durable current branch HEAD
- session `baselineSha`
- Cloudflare ephemeral workspace changes

On overlapping durable drift, return:

```ts
{
  code: "BASELINE_CONFLICT",
  baselineSha,
  durableSha,
  conflictingFiles
}
```

### 6. Add GitHub sign-in support

GitTrix does not currently provide user sign-in for GitHub.

Add one of:

- GitHub device-code OAuth flow for CLI/desktop use.
- Host-provided token provider API for apps like glib-code.
- Optional local credential storage for GitTrix-managed sessions.

Minimum viable path for glib-code:

```ts
new GitHubDurableAdapter({
  owner,
  repo,
  tokenProvider: glibCodeGitHubTokenProvider,
});
```

GitTrix should not block on owning the full sign-in UX if glib-code can supply tokens.

### 7. Add mixed-adapter tests

Add tests or smoke scripts for:

- GitHub durable + Cloudflare ephemeral session creation.
- `ephemeralPath` is git-backed.
- `git status`, `git log`, and `git diff` work inside `ephemeralPath`.
- Ephemeral edits do not mutate GitHub durable until promote.
- Promote applies selected changes back to GitHub durable.
- Baseline drift returns `BASELINE_CONFLICT`.
- Cloudflare ephemeral repo and local clone are cleaned up on eviction.

## Acceptance Criteria

The mixed adapter flow is complete when glib-code can start a session with GitHub durable and Cloudflare Artifacts ephemeral, receive a git-backed local `ephemeralPath`, run agents inside that path, and promote accepted changes back to GitHub without touching durable state before promote.
