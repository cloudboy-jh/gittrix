import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'bun:test'

import { GitTrix } from '@gittrix/core'

import { LocalDurableAdapter, LocalEphemeralAdapter, runGit } from './index.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

test('startSession creates a git-backed local worktree workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-local-'))
  cleanup.push(root)
  const repo = await createRepo(root)
  const sessionsRoot = join(root, 'sessions')
  const durable = new LocalDurableAdapter({ path: repo, branch: 'main' })
  const ephemeral = new LocalEphemeralAdapter({ sessionsRootDir: sessionsRoot })
  const gittrix = new GitTrix({ durable, ephemeral, storeDir: sessionsRoot, evictionSweepIntervalMs: 60_000 })

  await gittrix.init()
  try {
    const session = await gittrix.startSession({ task: 'test', durablePath: repo, durableBranch: 'main' })
    const [metadata] = await gittrix.listSessions()

    expect(metadata?.id).toBe(session.id)
    expect(metadata?.isGitBacked).toBe(true)
    expect(metadata?.workspaceKind).toBe('worktree')
    expect(metadata?.ephemeralPath).toBeTruthy()

    const ephemeralPath = metadata?.ephemeralPath ?? ''
    expect((await runGit(['rev-parse', '--show-toplevel'], ephemeralPath)).stdout.trim().replace(/\\/g, '/')).toBe(ephemeralPath)
    expect((await runGit(['rev-parse', 'HEAD'], ephemeralPath)).stdout.trim()).toBe(metadata?.baselineSha)
    expect((await runGit(['status', '--porcelain'], ephemeralPath)).stdout.trim()).toBe('')
    await runGit(['status'], ephemeralPath)
    await runGit(['remote', '-v'], ephemeralPath)
    await runGit(['log', '--oneline', '-5'], ephemeralPath)
  } finally {
    await gittrix.close()
  }
})

test('ephemeral edits stay isolated and promote applies accepted changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-local-'))
  cleanup.push(root)
  const repo = await createRepo(root)
  const sessionsRoot = join(root, 'sessions')
  const durable = new LocalDurableAdapter({ path: repo, branch: 'main' })
  const ephemeral = new LocalEphemeralAdapter({ sessionsRootDir: sessionsRoot })
  const gittrix = new GitTrix({ durable, ephemeral, storeDir: sessionsRoot, evictionSweepIntervalMs: 60_000 })

  await gittrix.init()
  try {
    const session = await gittrix.startSession({ task: 'test', durablePath: repo, durableBranch: 'main', eviction: { untilPromote: false } })
    const [metadata] = await gittrix.listSessions()
    const ephemeralPath = metadata?.ephemeralPath ?? ''
    await writeFile(join(ephemeralPath, 'src', 'base.txt'), 'changed\n', 'utf8')
    await writeFile(join(ephemeralPath, 'src', 'new.txt'), 'new\n', 'utf8')

    expect(await readFile(join(repo, 'src', 'base.txt'), 'utf8')).toBe('base\n')
    expect((await runGit(['diff', '--name-only', 'HEAD', '--'], ephemeralPath)).stdout).toContain('src/base.txt')
    expect((await runGit(['status', '--porcelain'], repo)).stdout.trim()).toBe('')

    const diff = await session.diff()
    expect(diff).toContain('src/base.txt')
    expect(diff).toContain('src/new.txt')

    const result = await session.promote({ selector: { mode: 'all' }, message: 'promote changes' })
    expect(result.sha.length).toBeGreaterThan(0)
    expect(await readFile(join(repo, 'src', 'base.txt'), 'utf8')).toBe('changed\n')
    expect(await readFile(join(repo, 'src', 'new.txt'), 'utf8')).toBe('new\n')
  } finally {
    await gittrix.close()
  }
})

test('baseline drift on overlapping files raises conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-local-'))
  cleanup.push(root)
  const repo = await createRepo(root)
  const sessionsRoot = join(root, 'sessions')
  const durable = new LocalDurableAdapter({ path: repo, branch: 'main' })
  const ephemeral = new LocalEphemeralAdapter({ sessionsRootDir: sessionsRoot })
  const gittrix = new GitTrix({ durable, ephemeral, storeDir: sessionsRoot, evictionSweepIntervalMs: 60_000 })

  await gittrix.init()
  try {
    const session = await gittrix.startSession({ task: 'test', durablePath: repo, durableBranch: 'main' })
    const [metadata] = await gittrix.listSessions()
    const ephemeralPath = metadata?.ephemeralPath ?? ''

    await writeFile(join(repo, 'src', 'base.txt'), 'durable\n', 'utf8')
    await runGit(['add', 'src/base.txt'], repo)
    await runGit(['commit', '-m', 'durable change'], repo)
    await writeFile(join(ephemeralPath, 'src', 'base.txt'), 'ephemeral\n', 'utf8')

    await expect(session.promote({ selector: { mode: 'all' }, message: 'promote changes' })).rejects.toMatchObject({
      code: 'BASELINE_CONFLICT',
      baselineSha: metadata?.baselineSha,
      conflictingFiles: ['src/base.txt'],
    })
  } finally {
    await gittrix.close()
  }
})

test('eviction removes worktree workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-local-'))
  cleanup.push(root)
  const repo = await createRepo(root)
  const sessionsRoot = join(root, 'sessions')
  const gittrix = new GitTrix({
    durable: new LocalDurableAdapter({ path: repo, branch: 'main' }),
    ephemeral: new LocalEphemeralAdapter({ sessionsRootDir: sessionsRoot }),
    storeDir: sessionsRoot,
    evictionSweepIntervalMs: 60_000,
  })

  await gittrix.init()
  try {
    const session = await gittrix.startSession({ task: 'test', durablePath: repo, durableBranch: 'main' })
    const [metadata] = await gittrix.listSessions()
    const ephemeralPath = metadata?.ephemeralPath ?? ''

    await gittrix.evict(session.id)

    expect(await pathExists(ephemeralPath)).toBe(false)
    expect((await runGit(['worktree', 'list'], repo)).stdout.replace(/\\/g, '/')).not.toContain(ephemeralPath)
  } finally {
    await gittrix.close()
  }
})

async function createRepo(root: string): Promise<string> {
  const repo = join(root, 'repo')
  await mkdir(join(repo, 'src'), { recursive: true })
  await runGit(['init', '-b', 'main'], repo)
  await runGit(['config', 'user.name', 'gittrix'], repo)
  await runGit(['config', 'user.email', 'gittrix@example.com'], repo)
  await writeFile(join(repo, 'src', 'base.txt'), 'base\n', 'utf8')
  await runGit(['add', '.'], repo)
  await runGit(['commit', '-m', 'base'], repo)
  return repo
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    try {
      await mkdir(path)
      await rm(path, { recursive: true, force: true })
      return false
    } catch {
      return true
    }
  }
}
