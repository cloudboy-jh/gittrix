import { AdapterUnavailableError } from '../../core/dist/index.js'

export interface GitResult {
  stdout: string
  stderr: string
  stdoutBytes: Uint8Array
  stderrBytes: Uint8Array
  exitCode: number
}

export async function runGit(_args: string[], _cwd: string): Promise<GitResult> {
  throw new AdapterUnavailableError('Code Storage adapter pending early access')
}
