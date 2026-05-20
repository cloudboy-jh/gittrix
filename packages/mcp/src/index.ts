#!/usr/bin/env node

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { LocalDurableAdapter, LocalEphemeralAdapter } from '@gittrix/adapter-local'
import { GitTrix } from '@gittrix/core'
import type { ListEntry, SessionInfo, SessionMetadata } from '@gittrix/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const sessionsRoot = process.env.GITTRIX_SESSIONS_ROOT ?? join(homedir(), '.gittrix', 'sessions')
const maxDiffBytes = Number.parseInt(process.env.GITTRIX_MCP_MAX_DIFF_BYTES ?? '30000', 10)

const server = new McpServer({ name: 'gittrix', version: '0.1.0' })

server.registerTool(
  'gittrix_start_session',
  {
    title: 'Start Gittrix session',
    description: 'Create a Gittrix session for staging agent changes.',
    inputSchema: {
      task: z.string(),
      durablePath: z.string().optional(),
      durableBranch: z.string().optional(),
    },
  },
  async ({ task, durablePath, durableBranch }) => withGittrix(durablePath, async (gittrix) => {
    const session = await gittrix.startSession({ task, durablePath: durablePath ?? process.cwd(), ...(durableBranch ? { durableBranch } : {}) })
    return text(formatSessionStarted(await session.info()))
  }),
)

server.registerTool(
  'gittrix_get_session',
  {
    title: 'Get Gittrix session',
    description: 'Return Gittrix session access info.',
    inputSchema: { sessionId: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, durablePath }) => withGittrix(durablePath, async (gittrix) => text(formatSessionInfo(await (await gittrix.getSession(sessionId)).info()))),
)

server.registerTool(
  'gittrix_list_sessions',
  {
    title: 'List Gittrix sessions',
    description: 'List Gittrix sessions from the local session store.',
    inputSchema: { status: z.enum(['active', 'promoted', 'discarded', 'expired', 'all']).optional(), durablePath: z.string().optional() },
  },
  async ({ status, durablePath }) => withGittrix(durablePath, async (gittrix) => {
    const sessions = await gittrix.listSessions()
    return text(formatSessionList(!status || status === 'all' ? sessions : sessions.filter((session) => session.state === status)))
  }),
)

server.registerTool(
  'gittrix_read_file',
  {
    title: 'Read Gittrix file',
    description: 'Read a file from a Gittrix session.',
    inputSchema: { sessionId: z.string(), path: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, path, durablePath }) => withSession(sessionId, durablePath, async (session) => {
    const content = Buffer.from(await session.read(path)).toString('utf8')
    return text(formatReadFile(sessionId, path, content))
  }),
)

server.registerTool(
  'gittrix_write_file',
  {
    title: 'Write Gittrix file',
    description: 'Write a UTF-8 file into a Gittrix session.',
    inputSchema: { sessionId: z.string(), path: z.string(), content: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, path, content, durablePath }) => withSession(sessionId, durablePath, async (session) => {
    await session.write(path, new TextEncoder().encode(content))
    return text(card('✍️ Wrote file', { session: sessionId, file: path, bytes: Buffer.byteLength(content, 'utf8') }))
  }),
)

server.registerTool(
  'gittrix_delete_file',
  {
    title: 'Delete Gittrix file',
    description: 'Delete a file from a Gittrix session.',
    inputSchema: { sessionId: z.string(), path: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, path, durablePath }) => withSession(sessionId, durablePath, async (session) => {
    await session.delete(path)
    return text(card('🗑️ Deleted file', { session: sessionId, file: path }))
  }),
)

server.registerTool(
  'gittrix_list_files',
  {
    title: 'List Gittrix files',
    description: 'List files visible in a Gittrix session.',
    inputSchema: { sessionId: z.string(), path: z.string().optional(), durablePath: z.string().optional() },
  },
  async ({ sessionId, path, durablePath }) => withSession(sessionId, durablePath, async (session) => text(formatFileList(sessionId, path ?? '.', await session.list(path)))),
)

server.registerTool(
  'gittrix_touched_files',
  {
    title: 'List touched Gittrix files',
    description: 'List files changed in a Gittrix session.',
    inputSchema: { sessionId: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, durablePath }) => withSession(sessionId, durablePath, async (session) => text(formatTouchedFiles(sessionId, await session.touchedFiles()))),
)

server.registerTool(
  'gittrix_diff',
  {
    title: 'Diff Gittrix session',
    description: 'Return the diff for a Gittrix session.',
    inputSchema: { sessionId: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, durablePath }) => withSession(sessionId, durablePath, async (session) => text(formatDiff(sessionId, await session.touchedFiles(), await session.diff()))),
)

server.registerTool(
  'gittrix_request_promote',
  {
    title: 'Request Gittrix promotion',
    description: 'Prepare a human-owned promotion request. Does not commit to durable storage.',
    inputSchema: { sessionId: z.string(), files: z.array(z.string()).optional(), message: z.string().optional(), durablePath: z.string().optional() },
  },
  async ({ sessionId, files, message, durablePath }) => withSession(sessionId, durablePath, async (session) => {
    const selectedFiles = files ?? await session.touchedFiles()
    const command = `gittrix promote ${sessionId}${selectedFiles.length ? ` --files=${selectedFiles.join(',')}` : ''}${message ? ` -m ${JSON.stringify(message)}` : ''}`
    return text(formatPromotionRequest(sessionId, selectedFiles, message, command, await session.diff()))
  }),
)

server.registerTool(
  'gittrix_discard_session',
  {
    title: 'Discard Gittrix session',
    description: 'Discard a Gittrix session.',
    inputSchema: { sessionId: z.string(), durablePath: z.string().optional() },
  },
  async ({ sessionId, durablePath }) => withSession(sessionId, durablePath, async (session) => {
    await session.discard()
    return text(card('🧹 Session discarded', { session: sessionId, state: 'discarded' }))
  }),
)

await server.connect(new StdioServerTransport())

async function withSession<T>(sessionId: string, durablePath: string | undefined, fn: (session: Awaited<ReturnType<GitTrix['getSession']>>) => Promise<T>): Promise<T> {
  return withGittrix(durablePath, async (gittrix) => fn(await gittrix.getSession(sessionId)))
}

async function withGittrix<T>(durablePath: string | undefined, fn: (gittrix: GitTrix) => Promise<T>): Promise<T> {
  const durableRoot = resolve(durablePath ?? process.env.GITTRIX_DURABLE_PATH ?? process.cwd())
  const gittrix = new GitTrix({
    durable: new LocalDurableAdapter({ path: durableRoot }),
    ephemeral: new LocalEphemeralAdapter({ sessionsRootDir: sessionsRoot }),
    storeDir: sessionsRoot,
  })
  await gittrix.init()
  try {
    return await fn(gittrix)
  } finally {
    await gittrix.close()
  }
}

function text(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

function formatSessionStarted(info: SessionInfo): string {
  return card('🧪 Gittrix session started', {
    session: info.sessionId,
    task: info.task,
    base: `${info.durableBranch ?? 'main'} @ ${shortSha(info.baselineSha)}`,
    workspace: info.workspacePath,
    mode: info.capabilities.filesystem ? 'isolated workspace' : 'api session',
  }, 'Agent writes are isolated until human promotion.')
}

function formatSessionInfo(info: SessionInfo): string {
  return card('🧭 Gittrix session', {
    session: info.sessionId,
    state: info.state,
    task: info.task,
    base: `${info.durableBranch ?? 'main'} @ ${shortSha(info.baselineSha)}`,
    touched: info.touchedFiles.length,
    workspace: info.workspacePath,
  }, info.touchedFiles.length ? bulletList(info.touchedFiles) : 'No touched files yet.')
}

function formatSessionList(sessions: SessionMetadata[]): string {
  if (sessions.length === 0) {
    return card('🗂️ Gittrix sessions', { count: 0 }, 'No sessions found.')
  }

  const rows = sessions.map((session) => [
    session.id,
    session.state,
    shortSha(session.baselineSha),
    session.touchedFiles.length.toString(),
    session.task,
  ])
  return `🗂️ Gittrix sessions\n\n${table(['session', 'state', 'base', 'files', 'task'], rows)}`
}

function formatReadFile(sessionId: string, path: string, content: string): string {
  return `${card('📖 Read file', { session: sessionId, file: path, bytes: Buffer.byteLength(content, 'utf8') })}\n\n\`\`\`\n${content}\n\`\`\``
}

function formatFileList(sessionId: string, path: string, entries: ListEntry[]): string {
  return card('🌲 Session files', { session: sessionId, path, count: entries.length }, entries.length ? bulletList(entries.map((entry) => `${entry.type === 'dir' ? '📁' : '📄'} ${entry.path}`)) : 'No files found.')
}

function formatTouchedFiles(sessionId: string, files: string[]): string {
  return card('📝 Touched files', { session: sessionId, count: files.length }, files.length ? bulletList(files) : 'No touched files yet.')
}

function formatDiff(sessionId: string, files: string[], diff: string): string {
  const bytes = Buffer.byteLength(diff, 'utf8')
  const summary = card('🔍 Session diff', { session: sessionId, files: files.length, size: formatBytes(bytes) })
  if (!diff.trim()) {
    return `${summary}\n\nNo changes.`
  }
  if (bytes > maxDiffBytes) {
    return `${summary}\n\nDiff is large (${formatBytes(bytes)}). Narrow the request or inspect touched files.`
  }
  return `${summary}\n\n\`\`\`diff\n${diff}\n\`\`\``
}

function formatPromotionRequest(sessionId: string, files: string[], message: string | undefined, command: string, diff: string): string {
  const bytes = Buffer.byteLength(diff, 'utf8')
  const body = [
    'Human command:',
    `\`${command}\``,
    '',
    files.length ? bulletList(files) : 'No files selected.',
  ]
  if (diff.trim() && bytes <= maxDiffBytes) {
    body.push('', '```diff', diff, '```')
  } else if (bytes > maxDiffBytes) {
    body.push('', `Diff is large (${formatBytes(bytes)}). Review with gittrix_diff before promotion.`)
  }
  return card('🚦 Promotion requested', { session: sessionId, files: files.length, message }, body.join('\n'))
}

function card(title: string, rows: Record<string, string | number | undefined>, body?: string): string {
  const visibleRows = Object.entries(rows).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
  const labelWidth = Math.max(0, ...visibleRows.map(([key]) => key.length))
  const lines = [title, '', ...visibleRows.map(([key, value]) => `${key.padEnd(labelWidth)} ${value}`)]
  if (body) {
    lines.push('', body)
  }
  return lines.join('\n')
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)))
  const render = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ')
  return [render(headers), render(headers.map((header) => '-'.repeat(header.length))), ...rows.map(render)].join('\n')
}
