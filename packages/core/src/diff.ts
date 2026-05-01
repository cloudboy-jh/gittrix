import { createPatch } from 'diff'

import type { DurableAdapter, EphemeralAdapter } from './types.js'

export async function computeDiff(opts: {
  ephemeral: EphemeralAdapter
  durable: DurableAdapter
  sessionId: string
  baselineSha: string
}): Promise<string> {
  const touched = await opts.ephemeral.touchedFiles(opts.sessionId)
  if (touched.length === 0) {
    return ''
  }

  const chunks: string[] = []
  for (const path of touched) {
    const exists = await opts.ephemeral.exists(opts.sessionId, path)
    const current = exists ? await opts.ephemeral.read(opts.sessionId, path) : null
    const baseline = await readDurableOrNull(opts.durable, opts.baselineSha, path)

    if (isBinary(current) || isBinary(baseline)) {
      chunks.push(`Binary files a/${path} and b/${path} differ\n`)
      continue
    }

    const before = baseline ? Buffer.from(baseline).toString('utf8') : ''
    const after = current ? Buffer.from(current).toString('utf8') : ''
    const patch = createPatch(path, before, after, 'a', 'b')
    chunks.push(patch.endsWith('\n') ? patch : `${patch}\n`)
  }

  return chunks.join('')
}

async function readDurableOrNull(durable: DurableAdapter, sha: string, path: string): Promise<Uint8Array | null> {
  try {
    return await durable.readAtSha(sha, path)
  } catch {
    return null
  }
}

function isBinary(bytes: Uint8Array | null): boolean {
  if (!bytes) {
    return false
  }
  const limit = Math.min(bytes.length, 8192)
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) {
      return true
    }
  }
  return false
}
