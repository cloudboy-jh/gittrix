import { createHash } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { AuthError } from '@gittrix/core'
import type { AdapterCapabilities, DurableAdapter, ListEntry } from '@gittrix/core'

import { runGit } from './run-git.js'

export type GitHubTokenProvider = () => Promise<string> | string

export interface GitHubDurableAdapterOptions {
  owner: string
  repo: string
  branch?: string
  token?: string
  tokenProvider?: GitHubTokenProvider
  mirrorRoot?: string
  remoteUrl?: string
  apiBaseUrl?: string
  gitUserName?: string
  gitUserEmail?: string
}

export interface GitHubPullRequestOptions {
  title: string
  body?: string
  head: string
  base?: string
  draft?: boolean
}

export interface GitHubPullRequestResult {
  number: number
  url: string
}

export class GitHubDurableAdapter implements DurableAdapter {
  private readonly branch: string
  private lastFetchAt = 0

  public constructor(private readonly options: GitHubDurableAdapterOptions) {
    this.branch = options.branch ?? 'main'
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
    const args = path === '.'
      ? ['ls-tree', '-r', '--name-only', sha]
      : ['ls-tree', '-r', '--name-only', sha, '--', normalizePath(path)]
    const result = await runGit(args, mirrorPath)
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
    await runGit(['config', 'user.name', this.options.gitUserName ?? 'gittrix-bot'], mirrorPath)
    await runGit(['config', 'user.email', this.options.gitUserEmail ?? 'gittrix-bot@users.noreply.github.com'], mirrorPath)

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

  public async openPullRequest(opts: GitHubPullRequestOptions): Promise<GitHubPullRequestResult> {
    const token = await this.getToken()
    const response = await fetch(`${this.apiBaseUrl()}/repos/${this.options.owner}/${this.options.repo}/pulls`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'gittrix',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base ?? this.branch,
        draft: opts.draft ?? false,
      }),
    })

    const data = (await response.json().catch(() => null)) as { number?: unknown; html_url?: unknown; message?: unknown } | null
    if (!response.ok) {
      throw new Error(`GitHub pull request failed (${response.status}): ${String(data?.message ?? response.statusText)}`)
    }
    if (typeof data?.number !== 'number' || typeof data.html_url !== 'string') {
      throw new Error('GitHub pull request response missing number or html_url')
    }
    return { number: data.number, url: data.html_url }
  }

  private async ensureMirror(): Promise<string> {
    const remote = this.remoteUrl()
    const authedRemote = await this.authedRemote(remote)
    const mirrorPath = this.mirrorPath(remote)

    await mkdir(dirname(mirrorPath), { recursive: true })
    if (!(await isGitRepo(mirrorPath))) {
      await rm(mirrorPath, { recursive: true, force: true })
      await runGit(['clone', authedRemote, mirrorPath], process.cwd())
      await writeFile(join(mirrorPath, '.gittrix-mirror'), 'gittrix github mirror\n', 'utf8')
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

  private mirrorPath(remoteUrl: string): string {
    const mirrorRoot = this.options.mirrorRoot ?? join(process.env.HOME ?? process.cwd(), '.gittrix', 'github-mirrors')
    const key = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
    return resolve(mirrorRoot, key)
  }

  private remoteUrl(): string {
    return this.options.remoteUrl ?? `https://github.com/${this.options.owner}/${this.options.repo}.git`
  }

  private apiBaseUrl(): string {
    return (this.options.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/, '')
  }

  private async authedRemote(remote: string): Promise<string> {
    const token = await this.getToken(false)
    if (!token) return remote

    const url = new URL(remote)
    url.username = 'x-access-token'
    url.password = token
    return url.toString()
  }

  private async getToken(required = true): Promise<string> {
    const token = this.options.token ?? (await this.options.tokenProvider?.())
    if (!token && required) {
      throw new AuthError('GitHub token is required')
    }
    return token ?? ''
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

async function gitSucceeds(args: string[], cwd: string): Promise<boolean> {
  try {
    await runGit(args, cwd)
    return true
  } catch {
    return false
  }
}

export { runGit }
