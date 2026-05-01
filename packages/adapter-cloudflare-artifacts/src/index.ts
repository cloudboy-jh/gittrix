import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { AdapterCapabilities, DurableAdapter, EphemeralAdapter, ListEntry } from '@gittrix/core'

import { ArtifactsClient } from './api.js'

export interface CloudflareArtifactsDurableOptions {
  accountId: string
  apiToken: string
  namespace?: string
  repoName: string
  branch?: string
  mirrorRoot?: string
}

export interface CloudflareArtifactsEphemeralOptions {
  accountId: string
  apiToken: string
  namespace?: string
  workingRoot?: string
}

export class CloudflareArtifactsDurableAdapter implements DurableAdapter {
  private readonly branch: string
  public constructor(private readonly options: CloudflareArtifactsDurableOptions) {
    this.branch = options.branch ?? 'main'
  }

  public capabilities(): AdapterCapabilities {
    return { git: true, push: true, fetch: true, history: true, ttl: false, latencyClass: 'regional' }
  }

  public async getHead(_branch: string): Promise<string> {
    throw new Error('CloudflareArtifactsDurableAdapter not implemented yet')
  }
  public async readAtSha(_sha: string, _path: string): Promise<Uint8Array> {
    throw new Error('CloudflareArtifactsDurableAdapter not implemented yet')
  }
  public async listAtSha(_sha: string, _path?: string): Promise<ListEntry[]> {
    throw new Error('CloudflareArtifactsDurableAdapter not implemented yet')
  }
  public async changedFilesBetween(_fromSha: string, _toSha: string): Promise<string[]> {
    throw new Error('CloudflareArtifactsDurableAdapter not implemented yet')
  }
  public async applyCommit(_opts: {
    files: Record<string, Uint8Array | null>
    message: string
    branch?: string
  }): Promise<{ sha: string; branch: string }> {
    throw new Error('CloudflareArtifactsDurableAdapter not implemented yet')
  }

  private mirrorPath(remoteUrl: string): string {
    const mirrorRoot = this.options.mirrorRoot ?? join(process.env.HOME ?? process.cwd(), '.gittrix', 'durable-mirrors')
    const key = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
    return resolve(mirrorRoot, key)
  }
}

export class CloudflareArtifactsEphemeralAdapter implements EphemeralAdapter {
  private readonly workingRoot: string
  private readonly client: ArtifactsClient

  public constructor(options: CloudflareArtifactsEphemeralOptions) {
    this.workingRoot = resolve(options.workingRoot ?? join(process.env.HOME ?? process.cwd(), '.gittrix', 'cf-artifacts-ephemeral'))
    this.client = new ArtifactsClient({
      accountId: options.accountId,
      apiToken: options.apiToken,
      namespace: options.namespace ?? 'default',
    })
  }

  public capabilities(): AdapterCapabilities {
    return { git: true, push: false, fetch: false, history: false, ttl: true, latencyClass: 'regional' }
  }

  public async initWorkspace(sessionId: string): Promise<void> {
    await mkdir(this.sessionPath(sessionId), { recursive: true })
    await this.client.createRepo(`gittrix-eph-${sessionId}`)
    await this.writeTouched(sessionId, [])
  }
  public async read(sessionId: string, path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.sessionPath(sessionId), path)))
  }
  public async write(sessionId: string, path: string, bytes: Uint8Array): Promise<void> {
    const full = join(this.sessionPath(sessionId), path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, bytes)
    await this.markTouched(sessionId, path)
  }
  public async delete(sessionId: string, path: string): Promise<void> {
    await rm(join(this.sessionPath(sessionId), path), { force: true })
    await this.markTouched(sessionId, path)
  }
  public async exists(sessionId: string, path: string): Promise<boolean> {
    try {
      return (await stat(join(this.sessionPath(sessionId), path))).isFile()
    } catch {
      return false
    }
  }
  public async list(sessionId: string): Promise<ListEntry[]> {
    const out: ListEntry[] = []
    await walk(this.sessionPath(sessionId), this.sessionPath(sessionId), out)
    return out
  }
  public async touchedFiles(sessionId: string): Promise<string[]> {
    return this.readTouched(sessionId)
  }
  public async destroy(sessionId: string): Promise<void> {
    await rm(this.sessionPath(sessionId), { recursive: true, force: true })
    await this.client.deleteRepo(`gittrix-eph-${sessionId}`)
  }

  private sessionPath(sessionId: string): string {
    return join(this.workingRoot, sessionId)
  }
  private touchedPath(sessionId: string): string {
    return join(this.workingRoot, sessionId, '.gittrix', '.gittrix-touched.json')
  }
  private async readTouched(sessionId: string): Promise<string[]> {
    try {
      const raw = await readFile(this.touchedPath(sessionId), 'utf8')
      const data = JSON.parse(raw) as { files?: unknown }
      return Array.isArray(data.files) ? data.files.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  private async writeTouched(sessionId: string, files: string[]): Promise<void> {
    const touchedPath = this.touchedPath(sessionId)
    await mkdir(dirname(touchedPath), { recursive: true })
    await writeFile(touchedPath, JSON.stringify({ files }, null, 2), 'utf8')
  }
  private async markTouched(sessionId: string, path: string): Promise<void> {
    const files = await this.readTouched(sessionId)
    if (!files.includes(path)) {
      files.push(path)
      await this.writeTouched(sessionId, files)
    }
  }
}

async function walk(root: string, dir: string, out: ListEntry[]): Promise<void> {
  const { readdir } = await import('node:fs/promises')
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.gittrix') continue
    const full = join(dir, entry.name)
    const rel = full.slice(root.length + 1).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      out.push({ path: rel, type: 'dir' })
      await walk(root, full, out)
    } else {
      out.push({ path: rel, type: 'file' })
    }
  }
}
