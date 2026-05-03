import { test } from 'bun:test'

import { CloudflareArtifactsDurableAdapter } from './index.js'

const hasEnv =
  Boolean(process.env.CF_ACCOUNT_ID) &&
  Boolean(process.env.CF_API_TOKEN) &&
  Boolean(process.env.CF_ARTIFACTS_NAMESPACE) &&
  Boolean(process.env.CF_ARTIFACTS_REPO)

test.skipIf(!hasEnv)('durable adapter can resolve head from real Cloudflare Artifacts repo', async () => {
  const adapter = new CloudflareArtifactsDurableAdapter({
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
    namespace: process.env.CF_ARTIFACTS_NAMESPACE!,
    repoName: process.env.CF_ARTIFACTS_REPO!,
    branch: process.env.CF_ARTIFACTS_BRANCH ?? 'main',
  })

  await adapter.getHead(process.env.CF_ARTIFACTS_BRANCH ?? 'main')
})
