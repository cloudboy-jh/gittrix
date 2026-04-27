import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { MetadataVersionError, SessionNotFoundError } from './errors.js'
import type { SessionMetadata } from './types.js'

export class SessionStore {
  public readonly rootDir: string

  public constructor(rootDir?: string) {
    this.rootDir = rootDir ?? join(homedir(), '.gittrix', 'sessions')
  }

  public async ensure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
  }

  public sessionDir(sessionId: string): string {
    return join(this.rootDir, sessionId)
  }

  public metadataPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'metadata.json')
  }

  public lockPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), '.lock')
  }

  public workspacePath(sessionId: string): string {
    return join(this.sessionDir(sessionId), 'workspace')
  }

  public async writeMetadata(metadata: SessionMetadata): Promise<void> {
    const dir = this.sessionDir(metadata.id)
    await mkdir(dir, { recursive: true })
    const destination = this.metadataPath(metadata.id)
    const temp = `${destination}.tmp`
    const payload = JSON.stringify(metadata, null, 2)
    await writeFile(temp, payload, 'utf8')
    await rename(temp, destination)
  }

  public async readMetadata(sessionId: string): Promise<SessionMetadata> {
    const path = this.metadataPath(sessionId)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      throw new SessionNotFoundError(sessionId)
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isMetadata(parsed)) {
      throw new MetadataVersionError((parsed as { metadataVersion?: unknown }).metadataVersion)
    }
    return parsed
  }

  public async listMetadata(): Promise<SessionMetadata[]> {
    await this.ensure()
    const entries = await readdir(this.rootDir)
    const results: SessionMetadata[] = []
    for (const sessionId of entries) {
      try {
        const metadata = await this.readMetadata(sessionId)
        results.push(metadata)
      } catch {
        continue
      }
    }
    return results
  }

  public async exists(sessionId: string): Promise<boolean> {
    try {
      await stat(this.metadataPath(sessionId))
      return true
    } catch {
      return false
    }
  }

  public async removeSessionFiles(sessionId: string): Promise<void> {
    await rm(this.workspacePath(sessionId), { recursive: true, force: true })
  }
}

function isMetadata(value: unknown): value is SessionMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }
  const v = value as Partial<SessionMetadata>
  return (
    v.metadataVersion === 1 &&
    typeof v.id === 'string' &&
    typeof v.task === 'string' &&
    typeof v.durableRef === 'string' &&
    typeof v.ephemeralRef === 'string' &&
    typeof v.baselineSha === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.lastAccessAt === 'string' &&
    Array.isArray(v.touchedFiles) &&
    !!v.promote
  )
}
