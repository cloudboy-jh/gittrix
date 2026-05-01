#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'

import { LocalDurableAdapter, LocalEphemeralAdapter } from '@gittrix/adapter-local'
import { GittrixError, GitTrix } from '@gittrix/core'

interface ParsedArgs {
  positional: string[]
  flags: Map<string, string | true>
}

const parsed = parseArgs(process.argv.slice(2))
const jsonMode = parsed.flags.has('json')

const sessionsRoot = join(homedir(), '.gittrix', 'sessions')
const durable = new LocalDurableAdapter({ path: process.cwd() })
const ephemeral = new LocalEphemeralAdapter({ sessionsRootDir: sessionsRoot })
const gittrix = new GitTrix({ durable, ephemeral, storeDir: sessionsRoot })

try {
  await gittrix.init()
  const [rawCommand, rawSubcommand, third, fourth, fifth] = parsed.positional
  const command = normalizeCommand(rawCommand)
  const subcommand = normalizeSubcommand(rawSubcommand)

  if (command === 'help' || !command) {
    printHelp(jsonMode)
  } else if (command === 'session' && subcommand === 'start') {
    const task = value(parsed, 'task') ?? third
    const durablePath = value(parsed, 'durable') ?? fourth
    const branch = value(parsed, 'branch') ?? fifth
    if (!task) {
      throw new Error('Missing task. Use: gittrix session start "<task>" <durable-path> [branch]')
    }
    if (!durablePath) {
      throw new Error('Missing durable path. Use: gittrix session start "<task>" <durable-path> [branch]')
    }

    const session = await gittrix.startSession(branch ? { task, durablePath, durableBranch: branch } : { task, durablePath })
    output({ sessionId: session.id }, jsonMode)
  } else if (command === 'session' && subcommand === 'list') {
    const status = value(parsed, 'status') ?? third
    const all = await gittrix.listSessions()
    const filtered = !status || status === 'all' ? all : all.filter((s) => s.state === status)
    output(filtered, jsonMode)
  } else if (command === 'session' && subcommand === 'diff') {
    const session = await gittrix.getSession(mustPositional(third, 'session-id'))
    output({ diff: await session.diff() }, jsonMode)
  } else if (command === 'session' && subcommand === 'log') {
    const session = await gittrix.getSession(mustPositional(third, 'session-id'))
    output(await session.log(), jsonMode)
  } else if (command === 'session' && subcommand === 'evict') {
    const sessionId = mustPositional(third, 'session-id')
    await gittrix.evict(sessionId)
    output({ evicted: sessionId }, jsonMode)
  } else if (command === 'promote') {
    const sessionId = mustPositional(subcommand, 'session-id')
    const strategy = (value(parsed, 'strategy') as 'auto' | undefined) ?? undefined
    const message = value(parsed, 'message')
    const filesFlag = value(parsed, 'files')

    const selector = filesFlag
      ? { mode: 'files' as const, files: filesFlag.split(',').map((x) => x.trim()).filter(Boolean) }
      : { mode: 'all' as const }

    const session = await gittrix.getSession(sessionId)
    const promoteOpts = {
      selector,
      ...(strategy ? { strategy } : {}),
      ...(message ? { message } : {}),
    }
    const result = await session.promote(promoteOpts)
    output(result, jsonMode)
  } else {
    throw new Error('Unknown command')
  }
} catch (error) {
  outputError(error, jsonMode)
  process.exitCode = 1
} finally {
  await gittrix.close()
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token) {
      continue
    }
    if (token.startsWith('-') && !token.startsWith('--')) {
      const alias = shortFlagAlias(token)
      if (alias) {
        const next = argv[i + 1]
        if (next && !next.startsWith('-')) {
          flags.set(alias, next)
          i += 1
        } else {
          flags.set(alias, true)
        }
        continue
      }
    }
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const [rawKey, rawValue] = token.slice(2).split('=')
    if (!rawKey) {
      continue
    }
    if (rawValue !== undefined) {
      flags.set(rawKey, rawValue)
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags.set(rawKey, next)
      i += 1
      continue
    }
    flags.set(rawKey, true)
  }
  return { positional, flags }
}

function value(parsed: ParsedArgs, key: string): string | undefined {
  const v = parsed.flags.get(key)
  if (v === true || v === undefined) {
    return undefined
  }
  return v
}

function mustFlag(parsed: ParsedArgs, key: string): string {
  const v = value(parsed, key)
  if (!v) {
    throw new Error(`Missing required flag --${key}`)
  }
  return v
}

function normalizeCommand(command: string | undefined): 'session' | 'promote' | 'help' | undefined {
  if (!command) {
    return undefined
  }
  if (command === 'session' || command === 's') {
    return 'session'
  }
  if (command === 'promote' || command === 'p') {
    return 'promote'
  }
  if (command === 'help' || command === '-h' || command === '--help') {
    return 'help'
  }
  return undefined
}

function normalizeSubcommand(subcommand: string | undefined): string | undefined {
  if (!subcommand) {
    return undefined
  }
  if (subcommand === 'ls') {
    return 'list'
  }
  return subcommand
}

function shortFlagAlias(token: string): string | null {
  switch (token) {
    case '-j':
      return 'json'
    case '-t':
      return 'task'
    case '-d':
      return 'durable'
    case '-b':
      return 'branch'
    case '-m':
      return 'message'
    case '-f':
      return 'files'
    case '-s':
      return 'strategy'
    default:
      return null
  }
}

function printHelp(jsonMode: boolean): void {
  const text = [
    'gittrix',
    '',
    'Session commands:',
    '  gittrix session start "<task>" <durable-path> [branch]',
    '  gittrix s start "<task>" <durable-path> [branch]',
    '  gittrix session list [active|promoted|discarded|expired|all]',
    '  gittrix session diff <session-id>',
    '  gittrix session log <session-id>',
    '  gittrix session evict <session-id>',
    '',
    'Promotion:',
    '  gittrix promote <session-id> [--files=a,b] [-m "msg"]',
    '  gittrix p <session-id> [--files=a,b] [-m "msg"]',
    '',
    'Flags:',
    '  --json (-j), --task (-t), --durable (-d), --branch (-b), --message (-m), --files (-f), --strategy (-s)',
  ].join('\n')

  output(text, jsonMode)
}

function mustPositional(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`)
    return
  }
  process.stdout.write(`${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n`)
}

function outputError(error: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    if (error instanceof GittrixError) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })}\n`,
      )
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'UNKNOWN', message } })}\n`)
    return
  }

  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
}
