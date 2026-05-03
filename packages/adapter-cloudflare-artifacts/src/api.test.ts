import { afterEach, describe, expect, test } from 'bun:test'

import { AuthError } from '@gittrix/core'

import { ArtifactsApiError, ArtifactsClient } from './api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('ArtifactsClient', () => {
  test('creates repo and returns typed result', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: true,
          result: { id: 'repo-1', remote: 'https://example/repo.git', token: 'tok', expires_at: '2030-01-01T00:00:00Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const client = new ArtifactsClient({ accountId: 'acct', apiToken: 'secret', namespace: 'default' })
    const repo = await client.createRepo('demo')
    expect(repo.id).toBe('repo-1')
    expect(repo.remote).toContain('repo.git')
  })

  test('throws AuthError on 401', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: 'nope' }], result: null }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const client = new ArtifactsClient({ accountId: 'acct', apiToken: 'bad' })
    await expect(client.getRepo('x')).rejects.toBeInstanceOf(AuthError)
  })

  test('throws ArtifactsApiError on api envelope failure', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 7003, message: 'invalid account id' }], result: null }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const client = new ArtifactsClient({ accountId: 'bad', apiToken: 'secret' })
    await expect(client.deleteRepo('x')).rejects.toBeInstanceOf(ArtifactsApiError)
  })
})
