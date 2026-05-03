import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { AdapterCapabilities, DurableAdapter, EphemeralAdapter, ListEntry } from '@gittrix/core'

import { ArtifactsClient } from './api.js'
import { runGit } from './run-git.js'

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
  private readonly client: ArtifactsClient
  private lastFetchAt = 0
  private cachedToken: { token: string; expiresAt: number } | null = null

  public constructor(private readonly options: CloudflareArtifactsDurableOptions) {
    this.branch = options.branch ?? 'main'
    this.client = new ArtifactsClient({
      accountId: options.accountId,
      apiToken: options.apiToken,
      namespace: options.namespace ?? 'default',
    })
  }

  public capabilities(): AdapterCapabilities {
    return { git: true, push: true, fetch: true, history: true, ttl: false, latencyClass: 'regional' }
  }

  public async getHead(branch = this.branch): Promise<string> {
    const mirrorPath = await this.ensureMirror()
    await this.ensureBranch(mirrorPath, branch)
    return (await runGit(['rev-parse', branch], mirrorPath)).stdout.trim()
  }
  public async readAtSha(sha: string, path: string): Promise<Uint8Array> {
    const mirrorPath = await this.ensureMirror()
    const result = await runGit(['show', `${sha}:${normalizePath(path)}`], mirrorPath)
    return result.stdoutBytes
  }
  public async listAtSha(sha: string, path = '.'): Promise<ListEntry[]> {
    const mirrorPath = await this.ensureMirror()
    const pathArg = path === '.' ? '' : normalizePath(path)
    const result = await runGit(['ls-tree', '-r', '--name-only', sha, '--', pathArg], mirrorPath)
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((filePath) => ({ path: filePath, type: 'file' as const }))
  }
  public async changedFilesBetween(fromSha: string, toSha: string): Promise<string[]> {
    const mirrorPath = await this.ensureMirror()
    const result = await runGit(['diff', '--name-only', `${fromSha}...${toSha}`], mirrorPath)
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
    const mirrorPath = await this.ensureMirror()
    await this.ensureBranch(mirrorPath, branch)

    await runGit(['checkout', branch], mirrorPath)
    await runGit(['config', 'user.name', 'gittrix-bot'], mirrorPath)
    await runGit(['config', 'user.email', 'gittrix-bot@users.noreply.local'], mirrorPath)

    for (const [file, bytes] of Object.entries(opts.files)) {
      const destination = join(mirrorPath, normalizePath(file))
      if (bytes === null) {
        await rm(destination, { force: true })
      } else {
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, bytes)
      }
    }

    const fileList = Object.keys(opts.files)
    await runGit(['add', '-A', '--', ...fileList], mirrorPath)
    const staged = await runGit(['diff', '--cached', '--name-only', '--', ...fileList], mirrorPath)
    if (!staged.stdout.trim()) {
      throw new Error('No staged changes for selected files')
    }

    await runGit(['commit', '-m', opts.message], mirrorPath)
    await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], mirrorPath)
    const sha = (await runGit(['rev-parse', 'HEAD'], mirrorPath)).stdout.trim()
    return { sha, branch }
  }

  private mirrorPath(remoteUrl: string): string {
    const mirrorRoot = this.options.mirrorRoot ?? join(process.env.HOME ?? process.cwd(), '.gittrix', 'durable-mirrors')
    const key = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
    return resolve(mirrorRoot, key)
  }

  private async ensureMirror(): Promise<string> {
    const repo = await this.getOrCreateRepo()
    const token = await this.getRepoToken()
    const authedRemote = withAuthToken(repo.remote, token)
    const mirrorPath = this.mirrorPath(repo.remote)

    await mkdir(dirname(mirrorPath), { recursive: true })
    if (!(await isGitRepo(mirrorPath))) {
      await rm(mirrorPath, { recursive: true, force: true })
      await runGit(['clone', authedRemote, mirrorPath], process.cwd())
      await writeFile(join(mirrorPath, '.gittrix-mirror'), 'gittrix mirror\n', 'utf8')
      this.lastFetchAt = Date.now()
    } else {
      await runGit(['remote', 'set-url', 'origin', authedRemote], mirrorPath)
      const now = Date.now()
      if (now - this.lastFetchAt > 30_000) {
        await runGit(['fetch', '--prune', 'origin'], mirrorPath)
        this.lastFetchAt = now
      }
    }
    return mirrorPath
  }

  private async getRepoToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.cachedToken.expiresAt - 5 * 60_000) {
      return this.cachedToken.token
    }
    const minted = await this.client.mintToken(this.options.repoName)
    const expiresAt = Date.parse(minted.expires_at)
    this.cachedToken = {
      token: minted.token,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + 10 * 60_000,
    }
    return this.cachedToken.token
  }

  private async getOrCreateRepo(): Promise<{ remote: string }> {
    try {
      const created = await this.client.createRepo(this.options.repoName)
      return { remote: created.remote }
    } catch {
      const existing = await this.client.getRepo(this.options.repoName)
      return { remote: existing.remote }
    }
  }

  private async ensureBranch(mirrorPath: string, branch: string): Promise<void> {
    const existsOnRemote = await gitSucceeds(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], mirrorPath)
    if (existsOnRemote) {
      await runGit(['checkout', '-B', branch, `origin/${branch}`], mirrorPath)
      return
    }

    const existsLocal = await gitSucceeds(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], mirrorPath)
    if (existsLocal) {
      await runGit(['checkout', branch], mirrorPath)
      return
    }

    await runGit(['checkout', '--orphan', branch], mirrorPath)
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
    const repoName = `gittrix-eph-${sessionId}`
    const repo = await this.client.createRepo(repoName)
    const token = await this.client.mintToken(repoName)
    const path = this.sessionPath(sessionId)
    await rm(path, { recursive: true, force: true })
    try {
      await runGit(['clone', withAuthToken(repo.remote, token.token), path], process.cwd())
    } catch {
      await mkdir(path, { recursive: true })
    }
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
  public async list(sessionId: string, path = '.'): Promise<ListEntry[]> {
    const out: ListEntry[] = []
    const root = this.sessionPath(sessionId)
    await walk(root, join(root, normalizePath(path)), out)
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

async function isGitRepo(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, '.git'))).isDirectory()
  } catch {
    return false
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function withAuthToken(remote: string, token: string): string {
  const url = new URL(remote)
  url.username = 'oauth2'
  url.password = token
  return url.toString()
}

async function gitSucceeds(args: string[], cwd: string): Promise<boolean> {
  try {
    await runGit(args, cwd)
    return true
  } catch {
    return false
  }
}
