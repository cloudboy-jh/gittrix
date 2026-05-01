import { spawn } from 'node:child_process'

import { AdapterUnavailableError } from '@gittrix/core'

export interface GitResult {
  stdout: string
  stderr: string
  stdoutBytes: Uint8Array
  stderrBytes: Uint8Array
  exitCode: number
}

export async function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const stdoutChunks: Uint8Array[] = []
    const stderrChunks: Uint8Array[] = []
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)))
    })
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)))
    })
    child.on('error', (err) => reject(new AdapterUnavailableError(`Failed to run git: ${err.message}`)))
    child.on('close', (exitCode) => {
      const stdoutBytes = concat(stdoutChunks)
      const stderrBytes = concat(stderrChunks)
      const stdout = Buffer.from(stdoutBytes).toString('utf8')
      const stderr = Buffer.from(stderrBytes).toString('utf8')
      const result: GitResult = { stdout, stderr, stdoutBytes, stderrBytes, exitCode: exitCode ?? -1 }
      if ((exitCode ?? 1) !== 0) {
        reject(new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${stderr || stdout}`))
        return
      }
      resolve(result)
    })
  })
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
