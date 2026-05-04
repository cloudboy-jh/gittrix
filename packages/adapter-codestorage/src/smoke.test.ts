import { expect, test } from 'bun:test'

import { AdapterUnavailableError } from '@gittrix/core'

import { CodeStorageDurableAdapter, CodeStorageEphemeralAdapter } from './index.js'

test('adapter-codestorage package loads', () => {
  const durable = new CodeStorageDurableAdapter({ namespace: 'test', repo: 'app' })
  const ephemeral = new CodeStorageEphemeralAdapter({ namespace: 'test' })

  expect(durable.capabilities()).toEqual({
    git: true,
    push: true,
    fetch: true,
    history: true,
    ttl: true,
    latencyClass: 'edge',
  })
  expect(ephemeral.capabilities()).toEqual(durable.capabilities())
})

test('adapter-codestorage methods are unavailable pending early access', async () => {
  const durable = new CodeStorageDurableAdapter({ namespace: 'test', repo: 'app' })

  await expect(durable.getHead('main')).rejects.toBeInstanceOf(AdapterUnavailableError)
})
