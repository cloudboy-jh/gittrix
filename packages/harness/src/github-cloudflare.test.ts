import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { expect, test } from 'bun:test'

import { CloudflareArtifactsEphemeralAdapter } from '@gittrix/adapter-cloudflare-artifacts'
import { GitHubDurableAdapter, runGit } from '@gittrix/adapter-github'
import { GitTrix } from '@gittrix/core'

test('GitHub durable + Cloudflare ephemeral creates a git-backed promotable workspace', async () => {
  const { durable, gittrix } = await createMixedHarness()
  await gittrix.init()
  const session = await gittrix.startSession({ task: 'mixed', durableBranch: 'main', eviction: { untilPromote: false } })
  const metadata = (await gittrix.listSessions()).find((entry) => entry.id === session.id)
  expect(metadata?.durableRef).toBe('github://local/repo#main')
  expect(metadata?.durablePath).toBeUndefined()
  expect(metadata?.isGitBacked).toBe(true)
  expect(metadata?.workspaceKind).toBe('remote')
  expect(metadata?.ephemeralPath).toBeTruthy()

  const ephemeralPath = metadata?.ephemeralPath ?? ''
  await runGit(['status', '--short'], ephemeralPath)
  await runGit(['log', '--oneline'], ephemeralPath)
  await runGit(['diff'], ephemeralPath)
  expect(await readFile(join(ephemeralPath, 'README.md'), 'utf8')).toBe('hello\n')

  await writeFile(join(ephemeralPath, 'README.md'), 'updated\n', 'utf8')
  expect(await durable.readAtSha(metadata?.baselineSha ?? '', 'README.md')).toEqual(new TextEncoder().encode('hello\n'))

  const result = await session.promote({ selector: { mode: 'all' }, message: 'promote mixed changes' })
  expect(await durable.readAtSha(result.sha, 'README.md')).toEqual(new TextEncoder().encode('updated\n'))

  await gittrix.close()
})

test('GitHub durable + Cloudflare ephemeral returns baseline conflict on overlapping drift', async () => {
  const { durable, gittrix } = await createMixedHarness()
  await gittrix.init()
  const session = await gittrix.startSession({ task: 'mixed conflict', durableBranch: 'main', eviction: { untilPromote: false } })
  const metadata = (await gittrix.listSessions()).find((entry) => entry.id === session.id)
  const ephemeralPath = metadata?.ephemeralPath ?? ''

  await writeFile(join(ephemeralPath, 'README.md'), 'ephemeral\n', 'utf8')
  await durable.applyCommit({
    branch: 'main',
    message: 'durable drift',
    files: { 'README.md': new TextEncoder().encode('durable\n') },
  })

  await expect(session.promote({ selector: { mode: 'all' }, message: 'promote drift' })).rejects.toMatchObject({
    code: 'BASELINE_CONFLICT',
    baselineSha: metadata?.baselineSha,
    conflictingFiles: ['README.md'],
  })

  await gittrix.close()
})

async function createMixedHarness(): Promise<{ durable: GitHubDurableAdapter; gittrix: GitTrix }> {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-gh-cf-'))
  const githubRemote = join(root, 'github.git')
  const cloudflareRemote = join(root, 'cloudflare.git')
  const seed = join(root, 'seed')

  await runGit(['init', '--bare', githubRemote], root)
  await runGit(['init', '--bare', cloudflareRemote], root)
  await runGit(['clone', githubRemote, seed], root)
  await runGit(['checkout', '-b', 'main'], seed)
  await runGit(['config', 'user.name', 'test'], seed)
  await runGit(['config', 'user.email', 'test@example.com'], seed)
  await writeFile(join(seed, 'README.md'), 'hello\n', 'utf8')
  await runGit(['add', 'README.md'], seed)
  await runGit(['commit', '-m', 'seed'], seed)
  await runGit(['push', 'origin', 'main'], seed)

  const durable = new GitHubDurableAdapter({
    owner: 'local',
    repo: 'repo',
    branch: 'main',
    remoteUrl: githubRemote,
    mirrorRoot: join(root, 'mirrors'),
  })
  const ephemeral = new CloudflareArtifactsEphemeralAdapter({
    accountId: 'acct',
    apiToken: 'tok',
    workingRoot: join(root, 'cf-working'),
  })
  ;(
    ephemeral as unknown as {
      client: {
        createRepo: (name: string) => Promise<{ id: string; remote: string; token: string; expires_at: string }>
        mintToken: (name: string) => Promise<{ token: string; expires_at: string }>
        deleteRepo: (name: string) => Promise<void>
      }
    }
  ).client = {
    createRepo: async () => ({ id: '1', remote: cloudflareRemote, token: 't', expires_at: '2030-01-01T00:00:00Z' }),
    mintToken: async () => ({ token: 't', expires_at: '2030-01-01T00:00:00Z' }),
    deleteRepo: async () => {},
  }

  return { durable, gittrix: new GitTrix({ durable, ephemeral, storeDir: join(root, 'sessions') }) }
}
