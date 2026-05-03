import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

import { afterEach, expect, test } from 'bun:test'

import { LocalDurableAdapter, LocalEphemeralAdapter } from '@gittrix/adapter-local'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

test('local ephemeral tracks touched files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gittrix-harness-eph-'))
  cleanup.push(root)

  const eph = new LocalEphemeralAdapter({ sessionsRootDir: root })
  await eph.initWorkspace('s1')
  await eph.write('s1', 'src/a.ts', new TextEncoder().encode('a'))
  await eph.delete('s1', 'src/b.ts')

  const touched = await eph.touchedFiles('s1')
  expect(touched).toContain('src/a.ts')
  expect(touched).toContain('src/b.ts')
})

test('local durable applyCommit writes and commits selected files', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'gittrix-harness-dur-'))
  cleanup.push(repo)

  await runGit(['init', '-b', 'main'], repo)
  await runGit(['config', 'user.name', 'harness'], repo)
  await runGit(['config', 'user.email', 'harness@example.com'], repo)
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'base.txt'), 'base\n', 'utf8')
  await runGit(['add', '.'], repo)
  await runGit(['commit', '-m', 'base'], repo)

  const durable = new LocalDurableAdapter({ path: repo, branch: 'main' })
  const result = await durable.applyCommit({
    files: {
      'src/new.txt': new TextEncoder().encode('hello\n'),
      'src/base.txt': null,
    },
    message: 'apply changes',
  })

  expect(result.branch).toBe('main')
  expect(result.sha.length).toBeGreaterThan(0)

  const changed = await durable.changedFilesBetween((await runGit(['rev-parse', 'HEAD~1'], repo)).trim(), result.sha)
  expect(changed).toContain('src/new.txt')
  expect(changed).toContain('src/base.txt')
})

async function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const stdout: Uint8Array[] = []
    const stderr: Uint8Array[] = []
    child.stdout.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk))))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk))))
    child.on('error', reject)
    child.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(Buffer.from(concat(stderr)).toString('utf8')))
        return
      }
      resolve(Buffer.from(concat(stdout)).toString('utf8').trim())
    })
  })
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
