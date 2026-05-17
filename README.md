![Gittrix logo](https://raw.githubusercontent.com/cloudboy-jh/gittrix/main/gittrix.png)

# Gittrix

Storage routing for AI coding agents. 🚀 <!-- edited by gittrix session -->

Gittrix routes AI agent writes into ephemeral workspaces and promotes only human-approved changes back to durable git storage.

Agents get an `AgentSession` for reads, writes, diffs, and synthetic commits. Humans keep the `UserSession`, which owns promotion into durable storage. That keeps agent execution off your canonical repo until reviewed changes are explicitly accepted.

## Packages

| Package | Version | Role | State |
| --- | ---: | --- | --- |
| `@gittrix/core` | `0.1.4` | Session orchestration and promotion API | Available |
| `@gittrix/adapter-local` | `0.1.4` | Local durable git repos and local ephemeral workspaces | Available |
| `@gittrix/adapter-github` | `0.2.0-alpha.2` | GitHub durable storage | Alpha |
| `@gittrix/adapter-cloudflare-artifacts` | `0.2.0-alpha.2` | Cloudflare Artifacts durable and ephemeral storage | Alpha |
| `@gittrix/adapter-codestorage` | `0.3.0-alpha.1` | Code Storage adapter | Scaffold only |
| `gittrix` CLI | `0.1.4` | Local repo/session commands | Local-only |

## Install

```bash
bun add @gittrix/core @gittrix/adapter-local
```

```bash
bun add @gittrix/core @gittrix/adapter-github @gittrix/adapter-local
```

```bash
bun add @gittrix/core @gittrix/adapter-cloudflare-artifacts
```

## Basic local usage

Local durable repo + local ephemeral workspace:

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

console.log(await session.diff())

await session.promote({
  selector: { mode: 'all' },
  message: 'docs: update readme',
})

await gittrix.close()
```

## GitHub durable + local ephemeral

Use GitHub as durable storage while keeping agent workspaces local:

```ts
import { GitTrix } from '@gittrix/core'
import { GitHubDurableAdapter } from '@gittrix/adapter-github'
import { LocalEphemeralAdapter } from '@gittrix/adapter-local'

const gittrix = new GitTrix({
  durable: new GitHubDurableAdapter({
    owner: 'acme',
    repo: 'app',
    branch: 'main',
    token: process.env.GITHUB_TOKEN,
  }),
  ephemeral: new LocalEphemeralAdapter({ sessionsRootDir: '/tmp/gittrix-sessions' }),
})

await gittrix.init()

const session = await gittrix.startSession({
  task: 'edit app code',
  durableBranch: 'main',
})

const agent = session.forAgent()
await agent.write('src/message.ts', new TextEncoder().encode('export const message = "hello"\n'))

await session.promote({
  selector: { mode: 'all' },
  message: 'feat: update message',
})

await gittrix.close()
```

GitHub tokens need Contents read/write for commits and pushes. Pull Requests read/write is only needed when calling `openPullRequest` directly.

## Cloudflare durable/ephemeral

Use Cloudflare Artifacts for both durable repo storage and remote ephemeral workspaces:

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

await gittrix.init()

const session = await gittrix.startSession({
  task: 'update worker',
  durableBranch: 'main',
})

const agent = session.forAgent()
await agent.write('src/worker.ts', new TextEncoder().encode('export default {}\n'))

await session.promote({
  selector: { mode: 'all' },
  message: 'chore: update worker',
})

await gittrix.close()
```

## Direct GitHub PR API

`UserSession.promote()` writes a durable commit, but it does not open PRs yet. For PR workflows, call the GitHub durable adapter API directly:

```ts
import { GitHubDurableAdapter } from '@gittrix/adapter-github'

const github = new GitHubDurableAdapter({
  owner: 'acme',
  repo: 'app',
  branch: 'main',
  token: process.env.GITHUB_TOKEN,
})

const result = await github.applyCommit({
  branch: 'gittrix/update-docs',
  message: 'docs: update readme',
  files: {
    'README.md': new TextEncoder().encode('# Updated\n'),
  },
})

const pr = await github.openPullRequest({
  title: 'Update docs',
  head: result.branch,
  base: 'main',
  body: 'Promoted from a Gittrix workflow.',
})

console.log(pr.url)
```

## Current limitations

- `@gittrix/adapter-codestorage` is scaffold-only and throws `ADAPTER_UNAVAILABLE`.
- Promotion is file-selection based; there is no hunk-level promotion yet.
- `UserSession.promote()` does not open PRs yet.
- `session.log()` returns `[]`.
- `session.commit()` returns synthetic ephemeral IDs like `ephemeral-...`.
- The CLI is local-only.
- Current core uses Node APIs.

## Development

```bash
bun install
bun run build
bun run typecheck
bun run test
```

Harness:

```bash
bun run testharness --
bun run testharness -- --integration
bun run testharness -- --all
bun run testharness -- --typecheck
```

## License

MIT
