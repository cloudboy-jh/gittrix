import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, expect, test } from 'bun:test'

import { CloudflareArtifactsEphemeralAdapter } from './index.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

test('ephemeral adapter tracks touched files and lists from subpaths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-cf-eph-'))
  cleanupPaths.push(root)

  const adapter = new CloudflareArtifactsEphemeralAdapter({
    accountId: 'acct',
    apiToken: 'tok',
    workingRoot: root,
  })

  ;(
    adapter as unknown as {
      client: {
        createRepo: (name: string) => Promise<{ id: string; remote: string; token: string; expires_at: string }>
        mintToken: (name: string) => Promise<{ token: string; expires_at: string }>
        deleteRepo: (name: string) => Promise<void>
      }
    }
  ).client = {
    createRepo: async () => ({ id: '1', remote: 'https://example.invalid/repo.git', token: 't', expires_at: '2030-01-01T00:00:00Z' }),
    mintToken: async () => ({ token: 't', expires_at: '2030-01-01T00:00:00Z' }),
    deleteRepo: async () => {},
  }

  const sessionId = 'session-1'
  await adapter.initWorkspace(sessionId)
  await adapter.write(sessionId, 'src/a.ts', new TextEncoder().encode('a'))
  await adapter.write(sessionId, 'src/nested/b.ts', new TextEncoder().encode('b'))
  await adapter.delete(sessionId, 'deleted.txt')

  const touched = await adapter.touchedFiles(sessionId)
  expect(touched).toContain('src/a.ts')
  expect(touched).toContain('src/nested/b.ts')
  expect(touched).toContain('deleted.txt')

  const listed = await adapter.list(sessionId, 'src')
  const listedPaths = listed.map((e) => e.path)
  expect(listedPaths).toContain('src/a.ts')
  expect(listedPaths).toContain('src/nested')
  expect(listedPaths).toContain('src/nested/b.ts')

  await adapter.destroy(sessionId)
})
