import { expect, test } from 'bun:test'

import { CloudflareArtifactsDurableAdapter } from '@gittrix/adapter-cloudflare-artifacts'

const enabled =
  Boolean(process.env.CF_ACCOUNT_ID) &&
  Boolean(process.env.CF_API_TOKEN) &&
  Boolean(process.env.CF_ARTIFACTS_NAMESPACE) &&
  Boolean(process.env.CF_ARTIFACTS_REPO)

test.skipIf(!enabled)('cloudflare durable resolves head', async () => {
  const branch = process.env.CF_ARTIFACTS_BRANCH ?? 'main'
  const adapter = new CloudflareArtifactsDurableAdapter({
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
    namespace: process.env.CF_ARTIFACTS_NAMESPACE!,
    repoName: process.env.CF_ARTIFACTS_REPO!,
    branch,
  })

  const sha = await adapter.getHead(branch)
  expect(sha.length).toBeGreaterThan(0)
})
