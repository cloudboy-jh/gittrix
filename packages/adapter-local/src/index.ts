import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import type {
  AdapterCapabilities,
  ApplyToDurableOpts,
  ApplyToDurableResult,
  CommitEntry,
  ListEntry,
  LocalSessionAdapter,
  SessionInit,
} from '@gittrix/core'
import { AdapterUnavailableError } from '@gittrix/core'

import { runGit } from './run-git.js'

export interface LocalAdapterOptions {
  sessionsRootDir: string
}

interface SessionPaths {
  durablePath: string
  ephemeralPath: string
  branch: string
}

export class LocalFsAdapter implements LocalSessionAdapter {
  private readonly sessionsRootDir: string
  private readonly sessions = new Map<string, SessionPaths>()

  public constructor(options: LocalAdapterOptions) {
    this.sessionsRootDir = options.sessionsRootDir
  }

  public capabilities(): AdapterCapabilities {
    return {
      git: true,
      push: false,
      fetch: false,
      history: true,
      ttl: false,
      latencyClass: 'local',
    }
  }

  public async initFromDurable(opts: SessionInit): Promise<void> {
    const branch = opts.durableBranch ?? 'main'
    await mkdir(opts.ephemeralPath, { recursive: true })
    await runGit(['clone', '--branch', branch, '--single-branch', opts.durablePath, opts.ephemeralPath], this.sessionsRootDir)

    this.sessions.set(opts.sessionId, {
      durablePath: resolve(opts.durablePath),
      ephemeralPath: resolve(opts.ephemeralPath),
      branch,
    })
  }

  public async restoreSession(opts: SessionInit): Promise<void> {
    this.sessions.set(opts.sessionId, {
      durablePath: resolve(opts.durablePath),
      ephemeralPath: resolve(opts.ephemeralPath),
      branch: opts.durableBranch ?? 'main',
    })
  }

  public async getDurableHead(durablePath: string, branch = 'main'): Promise<string> {
    const result = await runGit(['rev-parse', branch], durablePath)
    return result.stdout.trim()
  }

  public async getEphemeralHead(sessionId: string): Promise<string> {
    const session = this.mustGetSession(sessionId)
    const result = await runGit(['rev-parse', 'HEAD'], session.ephemeralPath)
    return result.stdout.trim()
  }

  public async readFromEphemeral(sessionId: string, path: string): Promise<Uint8Array> {
    const session = this.mustGetSession(sessionId)
    const filePath = join(session.ephemeralPath, path)
    return new Uint8Array(await readFile(filePath))
  }

  public async readFromDurableAtSha(durablePath: string, sha: string, path: string): Promise<Uint8Array> {
    const result = await runGit(['show', `${sha}:${normalizeGitPath(path)}`], durablePath)
    return new Uint8Array(result.stdoutBytes)
  }

  public async writeToEphemeral(sessionId: string, path: string, bytes: Uint8Array): Promise<void> {
    const session = this.mustGetSession(sessionId)
    const filePath = join(session.ephemeralPath, path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, bytes)
  }

  public async deleteFromEphemeral(sessionId: string, path: string): Promise<void> {
    const session = this.mustGetSession(sessionId)
    const filePath = join(session.ephemeralPath, path)
    await rm(filePath, { force: true })
  }

  public async pathExistsInEphemeral(sessionId: string, path: string): Promise<boolean> {
    const session = this.mustGetSession(sessionId)
    const filePath = join(session.ephemeralPath, path)
    try {
      const file = await stat(filePath)
      return file.isFile()
    } catch {
      return false
    }
  }

  public async listEphemeral(sessionId: string, path = '.'): Promise<ListEntry[]> {
    const session = this.mustGetSession(sessionId)
    const full = join(session.ephemeralPath, path)
    return listFilesRecursive(full, session.ephemeralPath)
  }

  public async listDurableAtSha(durablePath: string, sha: string, path = '.'): Promise<ListEntry[]> {
    const pathArg = path === '.' ? '' : normalizeGitPath(path)
    const result = await runGit(['ls-tree', '-r', '--name-only', sha, '--', pathArg], durablePath)
    const lines = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.map((filePath) => ({ path: filePath, type: 'file' as const }))
  }

  public async commitEphemeral(sessionId: string, message: string): Promise<string> {
    const session = this.mustGetSession(sessionId)
    await runGit(['add', '-A'], session.ephemeralPath)
    await runGit(['commit', '-m', message], session.ephemeralPath)
    const head = await runGit(['rev-parse', 'HEAD'], session.ephemeralPath)
    return head.stdout.trim()
  }

  public async diffEphemeral(sessionId: string, fromSha?: string): Promise<string> {
    const session = this.mustGetSession(sessionId)
    const args = fromSha ? ['diff', '--binary', `${fromSha}...HEAD`] : ['diff', '--binary']
    const result = await runGit(args, session.ephemeralPath)
    return result.stdout
  }

  public async logEphemeral(sessionId: string): Promise<CommitEntry[]> {
    const session = this.mustGetSession(sessionId)
    const format = '%H%x1f%an%x1f%ae%x1f%aI%x1f%s'
    const result = await runGit(['log', `--pretty=format:${format}`], session.ephemeralPath)
    const lines = result.stdout.split('\n').filter(Boolean)
    return lines.map((line) => {
      const [sha, authorName, authorEmail, timestamp, message] = line.split('\x1f')
      return {
        sha: sha ?? '',
        authorName: authorName ?? '',
        authorEmail: authorEmail ?? '',
        timestamp: timestamp ?? '',
        message: message ?? '',
      }
    })
  }

  public async changedFilesBetween(durablePath: string, fromSha: string, toSha: string): Promise<string[]> {
    const result = await runGit(['diff', '--name-only', `${fromSha}...${toSha}`], durablePath)
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  public async applyToDurable(opts: ApplyToDurableOpts): Promise<ApplyToDurableResult> {
    const session = this.mustGetSession(opts.sessionId)

    for (const file of opts.files) {
      const source = join(session.ephemeralPath, file)
      const destination = join(session.durablePath, file)
      const exists = await this.pathExistsInEphemeral(opts.sessionId, file)
      if (exists) {
        await mkdir(dirname(destination), { recursive: true })
        const bytes = await readFile(source)
        await writeFile(destination, new Uint8Array(bytes))
      } else {
        await rm(destination, { force: true })
      }
    }

    await runGit(['add', '-A', '--', ...opts.files], session.durablePath)

    const staged = await runGit(['diff', '--cached', '--name-only', '--', ...opts.files], session.durablePath)
    if (staged.stdout.trim().length === 0) {
      throw new Error('No staged changes for selected files')
    }

    await runGit(['commit', '-m', opts.message], session.durablePath)
    const sha = (await runGit(['rev-parse', 'HEAD'], session.durablePath)).stdout.trim()
    const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], session.durablePath)).stdout.trim()

    return {
      sha,
      branch,
    }
  }

  public async destroy(sessionId: string): Promise<void> {
    const session = this.mustGetSession(sessionId)
    await rm(session.ephemeralPath, { recursive: true, force: true })
    this.sessions.delete(sessionId)
  }

  private mustGetSession(sessionId: string): SessionPaths {
    const session = this.sessions.get(sessionId)
    if (!session) {
      const fallbackPath = resolve(this.sessionsRootDir, sessionId, 'workspace')
      const inferred: SessionPaths = {
        durablePath: '',
        ephemeralPath: fallbackPath,
        branch: 'main',
      }
      this.sessions.set(sessionId, inferred)
      return inferred
    }
    return session
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
    if (entry.name === '.git') {
      continue
    }
    const fullPath = join(path, entry.name)
    const relPath = normalizeRelativePath(relative(root, fullPath))
    if (entry.isDirectory()) {
      entries.push({ path: relPath, type: 'dir' })
      const nested = await listFilesRecursive(fullPath, root)
      entries.push(...nested)
    } else {
      entries.push({ path: relPath, type: 'file' })
    }
  }

  return entries
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, '/')
}

export { runGit }
