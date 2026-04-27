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
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const stdoutChunks: Uint8Array[] = []
    const stderrChunks: Uint8Array[] = []

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)))
    })
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)))
    })

    child.on('error', (err) => {
      reject(new AdapterUnavailableError(`Failed to run git: ${err.message}`))
    })

    child.on('close', (exitCode) => {
      const stdoutBytes = concatChunks(stdoutChunks)
      const stderrBytes = concatChunks(stderrChunks)
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

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}
