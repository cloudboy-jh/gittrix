![Gittrix logo](https://raw.githubusercontent.com/cloudboy-jh/gittrix/main/gittrix.png)

# Gittrix

Storage routing for AI coding agents.

Gittrix gives every agent task an ephemeral workspace and keeps your durable repo clean until a human promotes the accepted changes.

## Install

Pick the durable adapter for the repo you want Gittrix to write to, plus an ephemeral adapter for agent workspaces.

```bash
bun add @gittrix/core @gittrix/adapter-local
```

```bash
bun add @gittrix/core @gittrix/adapter-github @gittrix/adapter-local
```

```bash
bun add @gittrix/core @gittrix/adapter-cloudflare-artifacts
```

CLI:

```bash
bun add -g gittrix
```

## Adapters

| Package | Durable | Ephemeral | Status |
| --- | --- | --- | --- |
| `@gittrix/adapter-local` | yes | yes | available |
| `@gittrix/adapter-github` | yes | no | available |
| `@gittrix/adapter-cloudflare-artifacts` | yes | yes | available |

## Basic usage

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

const diff = await session.diff()
console.log(diff)

await session.promote({
  selector: { mode: 'all' },
  message: 'docs: update readme',
})

await gittrix.close()
```

## GitHub durable adapter

Use GitHub when promoted changes should land in a GitHub repo.

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

Required GitHub token permissions:

- Contents: read/write for commits and pushes
- Pull requests: read/write if you call `openPullRequest`

Create a branch commit and open a PR:

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

## Cloudflare Artifacts adapter

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
