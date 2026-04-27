import { open, unlink } from 'node:fs/promises'

import { EvictionRaceError } from './errors.js'

export async function withSessionLock<T>(lockPath: string, sessionId: string, fn: () => Promise<T>): Promise<T> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(lockPath, 'wx')
  } catch {
    throw new EvictionRaceError(sessionId)
  }

  try {
    return await fn()
  } finally {
    try {
      await handle.close()
    } catch {
      // noop
    }
    try {
      await unlink(lockPath)
    } catch {
      // noop
    }
  }
}
