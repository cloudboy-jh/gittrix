import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { expect, test } from 'bun:test'

import { GitHubDurableAdapter, runGit } from './index.js'

test('durable adapter reads and pushes through a git remote', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-gh-'))
  const bare = join(root, 'remote.git')
  const seed = join(root, 'seed')
  const mirrors = join(root, 'mirrors')

  await runGit(['init', '--bare', bare], root)
  await runGit(['clone', bare, seed], root)
  await runGit(['checkout', '-b', 'main'], seed)
  await runGit(['config', 'user.name', 'test'], seed)
  await runGit(['config', 'user.email', 'test@example.com'], seed)
  await writeFile(join(seed, 'README.md'), 'hello\n', 'utf8')
  await runGit(['add', 'README.md'], seed)
  await runGit(['commit', '-m', 'seed'], seed)
  await runGit(['push', 'origin', 'main'], seed)

  const adapter = new GitHubDurableAdapter({
    owner: 'local',
    repo: 'remote',
    branch: 'main',
    remoteUrl: bare,
    mirrorRoot: mirrors,
  })

  const head = await adapter.getHead('main')
  expect(await adapter.readAtSha(head, 'README.md')).toEqual(new TextEncoder().encode('hello\n'))
  expect(await adapter.listAtSha(head)).toContainEqual({ path: 'README.md', type: 'file' })

  const result = await adapter.applyCommit({
    branch: 'main',
    message: 'update readme',
    files: { 'README.md': new TextEncoder().encode('updated\n') },
  })

  expect(result.branch).toBe('main')
  expect(await adapter.readAtSha(result.sha, 'README.md')).toEqual(new TextEncoder().encode('updated\n'))
})
