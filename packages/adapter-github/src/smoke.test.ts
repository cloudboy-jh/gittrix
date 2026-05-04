import { expect, test } from 'bun:test'

import { GitHubDurableAdapter } from './index.js'

test('adapter-github package loads', () => {
  const adapter = new GitHubDurableAdapter({ owner: 'cloudboy-jh', repo: 'gittrix' })
  expect(adapter.capabilities()).toMatchObject({ git: true, push: true, fetch: true, history: true })
})
