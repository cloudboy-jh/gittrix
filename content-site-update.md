# GitTrix Content Site Update

GitTrix now supports mixed durable/ephemeral sessions with GitHub as the durable source of truth and Cloudflare Artifacts as the ephemeral agent workspace.

## New Capability

Agents can now start a session backed by:

```txt
durable: GitHub
ephemeral: Cloudflare Artifacts
```

GitTrix creates a git-backed local `ephemeralPath` from the Cloudflare Artifacts ephemeral repo, hydrates it from the GitHub baseline, and lets agents run normal git commands inside that workspace.

## Why This Matters

- Durable state stays in GitHub until promotion.
- Agent edits happen in an isolated Cloudflare Artifacts ephemeral repo.
- The local `ephemeralPath` supports `git status`, `git log`, and `git diff`.
- Accepted changes can be promoted back to GitHub using GitTrix baseline/conflict rules.
- If GitHub changes overlap with ephemeral edits, promotion returns `BASELINE_CONFLICT` instead of overwriting durable changes.

## Session Metadata

Sessions now support non-local durable adapters without requiring `durablePath`.

Relevant metadata includes:

```ts
{
  durableRef: "github://owner/repo#branch",
  durablePath: undefined,
  durableBranch: "main",
  ephemeralRef: "cloudflare://default/gittrix-eph-session-id",
  ephemeralPath: "/local/path/to/cloudflare/clone",
  baselineSha: "...",
  workspaceKind: "remote",
  isGitBacked: true
}
```

## Cloudflare Ephemeral Workspaces

Cloudflare Artifacts ephemeral sessions now:

- Create an artifact repo per session.
- Clone it locally for agent execution.
- Materialize the GitHub durable baseline into the clone.
- Commit a baseline so git commands work normally.
- Track API-written files, deleted files, unstaged changes, staged changes, and untracked files.
- Exclude `.git`, `.gittrix`, `.glib`, and internal metadata from session changes.

## GitHub Promotion

Promotion still compares:

- GitHub branch HEAD
- Session `baselineSha`
- Selected Cloudflare ephemeral changes

If durable GitHub drift overlaps selected ephemeral files, GitTrix returns:

```ts
{
  code: "BASELINE_CONFLICT",
  baselineSha,
  durableSha,
  conflictingFiles
}
```

## Verification

The mixed adapter flow is covered by the harness using a local GitHub-style bare remote and a Cloudflare Artifacts ephemeral adapter stub.

Verified with:

```sh
bun run typecheck
bun run test
suitener check packages/harness
```

## Current Status

The GitHub durable + Cloudflare Artifacts ephemeral path is implemented, tested, committed, and pushed.

Commit:

```txt
10c1047 Support GitHub durable Cloudflare ephemeral sessions
```
