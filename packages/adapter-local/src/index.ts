import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import type { AdapterCapabilities, DurableAdapter, EphemeralAdapter, ListEntry } from '@gittrix/core'

import { runGit } from './run-git.js'

export interface LocalDurableAdapterOptions {
  path: string
  branch?: string
}

export interface LocalEphemeralAdapterOptions {
  sessionsRootDir: string
}

export class LocalDurableAdapter implements DurableAdapter {
  private readonly path: string
  private readonly branch: string

  public constructor(options: LocalDurableAdapterOptions) {
    this.path = resolve(options.path)
    this.branch = options.branch ?? 'main'
  }

  public capabilities(): AdapterCapabilities {
    return { git: true, push: false, fetch: false, history: true, ttl: false, latencyClass: 'local' }
  }

  public async getHead(branch = this.branch): Promise<string> {
    return (await runGit(['rev-parse', branch], this.path)).stdout.trim()
  }

  public async readAtSha(sha: string, path: string): Promise<Uint8Array> {
    const result = await runGit(['show', `${sha}:${normalizePath(path)}`], this.path)
    return new Uint8Array(result.stdoutBytes)
  }

  public async listAtSha(sha: string, path = '.'): Promise<ListEntry[]> {
    const pathArg = path === '.' ? '' : normalizePath(path)
    const result = await runGit(['ls-tree', '-r', '--name-only', sha, '--', pathArg], this.path)
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((filePath) => ({ path: filePath, type: 'file' as const }))
  }

  public async changedFilesBetween(fromSha: string, toSha: string): Promise<string[]> {
    const result = await runGit(['diff', '--name-only', `${fromSha}...${toSha}`], this.path)
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  public async applyCommit(opts: {
    files: Record<string, Uint8Array | null>
    message: string
    branch?: string
  }): Promise<{ sha: string; branch: string }> {
    const branch = opts.branch ?? this.branch
    for (const [file, bytes] of Object.entries(opts.files)) {
      const destination = join(this.path, file)
      if (bytes === null) {
        await rm(destination, { force: true })
      } else {
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, bytes)
      }
    }

    const fileList = Object.keys(opts.files)
    await runGit(['add', '-A', '--', ...fileList], this.path)
    const staged = await runGit(['diff', '--cached', '--name-only', '--', ...fileList], this.path)
    if (!staged.stdout.trim()) {
      throw new Error('No staged changes for selected files')
    }
    await runGit(['commit', '-m', opts.message], this.path)
    const sha = (await runGit(['rev-parse', 'HEAD'], this.path)).stdout.trim()
    return { sha, branch }
  }
}

export class LocalEphemeralAdapter implements EphemeralAdapter {
  private readonly sessionsRootDir: string

  public constructor(options: LocalEphemeralAdapterOptions) {
    this.sessionsRootDir = resolve(options.sessionsRootDir)
  }

  public capabilities(): AdapterCapabilities {
    return { git: false, push: false, fetch: false, history: false, ttl: false, latencyClass: 'local' }
  }

  public async initWorkspace(sessionId: string): Promise<void> {
    await mkdir(this.sessionPath(sessionId), { recursive: true })
    await this.saveTouched(sessionId, [])
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
      const file = await stat(join(this.sessionPath(sessionId), path))
      return file.isFile()
    } catch {
      return false
    }
  }

  public async list(sessionId: string, path = '.'): Promise<ListEntry[]> {
    return listFilesRecursive(join(this.sessionPath(sessionId), path), this.sessionPath(sessionId))
  }

  public async touchedFiles(sessionId: string): Promise<string[]> {
    return this.loadTouched(sessionId)
  }

  public async destroy(sessionId: string): Promise<void> {
    await rm(this.sessionPath(sessionId), { recursive: true, force: true })
  }

  private sessionPath(sessionId: string): string {
    return resolve(this.sessionsRootDir, sessionId, 'workspace')
  }

  private touchedPath(sessionId: string): string {
    return join(this.sessionPath(sessionId), '.gittrix-touched.json')
  }

  private async loadTouched(sessionId: string): Promise<string[]> {
    try {
      const raw = await readFile(this.touchedPath(sessionId), 'utf8')
      const data = JSON.parse(raw) as { files?: unknown }
      return Array.isArray(data.files) ? data.files.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }

  private async saveTouched(sessionId: string, files: string[]): Promise<void> {
    await writeFile(this.touchedPath(sessionId), JSON.stringify({ files }, null, 2), 'utf8')
  }

  private async markTouched(sessionId: string, path: string): Promise<void> {
    const touched = await this.loadTouched(sessionId)
    if (!touched.includes(path)) {
      touched.push(path)
      await this.saveTouched(sessionId, touched)
    }
  }
}

/** @deprecated Use LocalDurableAdapter + LocalEphemeralAdapter. */
export class LocalFsAdapter {
  public constructor(_: LocalEphemeralAdapterOptions) {
    throw new Error('LocalFsAdapter is removed. Use LocalDurableAdapter + LocalEphemeralAdapter.')
  }
}

async function listFilesRecursive(path: string, root: string): Promise<ListEntry[]> {
  const entries: ListEntry[] = []
  let dirEntries: Awaited<ReturnType<typeof readdir>>
  try {
    dirEntries = await readdir(path, { withFileTypes: true })
  } catch {
    return entries
  }
  for (const entry of dirEntries) {
    if (entry.name === '.git' || entry.name === '.gittrix-touched.json') continue
    const fullPath = join(path, entry.name)
    const relPath = normalizePath(relative(root, fullPath))
    if (entry.isDirectory()) {
      entries.push({ path: relPath, type: 'dir' })
      entries.push(...(await listFilesRecursive(fullPath, root)))
    } else {
      entries.push({ path: relPath, type: 'file' })
    }
  }
  return entries
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export { runGit }
