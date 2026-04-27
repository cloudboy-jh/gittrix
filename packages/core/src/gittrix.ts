import { EventEmitter } from 'node:events'

import { nanoid } from 'nanoid'

import { BaselineConflictError, CapabilityMissingError, PromoteFailedError, SessionExpiredError } from './errors.js'
import { withSessionLock } from './lock.js'
import { parseLocalRefUri, toRefUri } from './ref.js'
import { SessionStore } from './session-store.js'
import type {
  AgentSession,
  CommitEntry,
  EvictionPolicy,
  ListEntry,
  LocalSessionAdapter,
  PromoteOpts,
  PromoteResult,
  SessionMetadata,
  StartSessionOpts,
  UserSession,
} from './types.js'

const DEFAULT_EVICTION: EvictionPolicy = {
  ttlIdleMs: 4 * 60 * 60 * 1000,
  ttlAbsoluteMs: null,
  untilPromote: true,
  manual: false,
}

export interface GitTrixOptions {
  adapter: LocalSessionAdapter
  storeDir?: string
  defaultEviction?: Partial<EvictionPolicy>
  evictionSweepIntervalMs?: number
}

export class GitTrix extends EventEmitter {
  private readonly adapter: LocalSessionAdapter
  private readonly store: SessionStore
  private readonly defaultEviction: EvictionPolicy
  private readonly sweepIntervalMs: number
  private sweepTimer: NodeJS.Timeout | null = null

  public constructor(options: GitTrixOptions) {
    super()
    this.adapter = options.adapter
    this.store = new SessionStore(options.storeDir)
    this.defaultEviction = {
      ...DEFAULT_EVICTION,
      ...options.defaultEviction,
    }
    this.sweepIntervalMs = options.evictionSweepIntervalMs ?? 5 * 60 * 1000

    const capabilities = this.adapter.capabilities()
    if (!capabilities.git) {
      throw new CapabilityMissingError('Local MVP requires git capability')
    }
  }

  public async init(): Promise<void> {
    await this.store.ensure()
    await this.sweepEvictions()
    this.sweepTimer = setInterval(() => {
      void this.sweepEvictions()
    }, this.sweepIntervalMs)
    this.sweepTimer.unref?.()
  }

  public async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  public async startSession(opts: StartSessionOpts): Promise<GitTrixSession> {
    const id = `sess_${nanoid(12)}`
    const now = new Date().toISOString()
    const branch = opts.durableBranch ?? 'main'
    const ephemeralPath = this.store.workspacePath(id)

    await this.adapter.initFromDurable({
      sessionId: id,
      durablePath: opts.durablePath,
      durableBranch: branch,
      ephemeralPath,
    })

    const baselineSha = await this.adapter.getDurableHead(opts.durablePath, branch)

    const metadata: SessionMetadata = {
      metadataVersion: 1,
      id,
      task: opts.task,
      durableRef: toRefUri({ type: 'local', path: opts.durablePath, branch }),
      ephemeralRef: toRefUri({ type: 'local', path: ephemeralPath, branch }),
      baselineSha,
      state: 'active',
      createdAt: now,
      updatedAt: now,
      lastAccessAt: now,
      evictionPolicy: {
        ...this.defaultEviction,
        ...opts.eviction,
      },
      touchedFiles: [],
      promote: {
        strategy: 'auto',
        result: null,
      },
    }

    await this.store.writeMetadata(metadata)
    this.emit('session.start', { sessionId: id })
    return new GitTrixSession(this.adapter, this.store, metadata, this)
  }

  public async getSession(sessionId: string): Promise<GitTrixSession> {
    const metadata = await this.store.readMetadata(sessionId)
    const durable = parseLocalRefUri(metadata.durableRef)
    const ephemeral = parseLocalRefUri(metadata.ephemeralRef)
    await this.adapter.restoreSession({
      sessionId,
      durablePath: durable.path,
      durableBranch: durable.branch ?? 'main',
      ephemeralPath: ephemeral.path,
    })
    if (metadata.state !== 'active') {
      throw new SessionExpiredError(sessionId, metadata.state)
    }
    return new GitTrixSession(this.adapter, this.store, metadata, this)
  }

  public async listSessions(): Promise<SessionMetadata[]> {
    return this.store.listMetadata()
  }

  public async evict(sessionId: string, state: 'expired' | 'discarded' | 'promoted' = 'expired'): Promise<void> {
    const metadata = await this.store.readMetadata(sessionId)
    const durable = parseLocalRefUri(metadata.durableRef)
    const ephemeral = parseLocalRefUri(metadata.ephemeralRef)
    await this.adapter.restoreSession({
      sessionId,
      durablePath: durable.path,
      durableBranch: durable.branch ?? 'main',
      ephemeralPath: ephemeral.path,
    })
    await withSessionLock(this.store.lockPath(sessionId), sessionId, async () => {
      await this.adapter.destroy(sessionId)
      await this.store.removeSessionFiles(sessionId)
      const now = new Date().toISOString()
      metadata.state = state
      metadata.updatedAt = now
      metadata.lastAccessAt = now
      await this.store.writeMetadata(metadata)
      this.emit('session.evict', { sessionId })
    })
  }

  public async sweepEvictions(): Promise<void> {
    const sessions = await this.store.listMetadata()
    const now = Date.now()
    for (const session of sessions) {
      if (session.state !== 'active') {
        continue
      }

      if (session.evictionPolicy.manual) {
        continue
      }

      const createdAt = Date.parse(session.createdAt)
      const lastAccessAt = Date.parse(session.lastAccessAt)
      const ttlAbsolute = session.evictionPolicy.ttlAbsoluteMs
      const ttlIdle = session.evictionPolicy.ttlIdleMs
      const absoluteExpired = ttlAbsolute !== null && now - createdAt > ttlAbsolute
      const idleExpired = ttlIdle !== null && now - lastAccessAt > ttlIdle

      if (absoluteExpired || idleExpired) {
        try {
          await this.evict(session.id, 'expired')
        } catch {
          continue
        }
      }
    }
  }
}

export class GitTrixSession implements UserSession {
  private readonly adapter: LocalSessionAdapter
  private readonly store: SessionStore
  private metadata: SessionMetadata
  private readonly owner: GitTrix

  public constructor(adapter: LocalSessionAdapter, store: SessionStore, metadata: SessionMetadata, owner: GitTrix) {
    this.adapter = adapter
    this.store = store
    this.metadata = metadata
    this.owner = owner
  }

  public get id(): string {
    return this.metadata.id
  }

  public forAgent(): AgentSession {
    return {
      read: this.read.bind(this),
      write: this.write.bind(this),
      delete: this.delete.bind(this),
      commit: this.commit.bind(this),
      writeAndCommit: this.writeAndCommit.bind(this),
      list: this.list.bind(this),
      diff: this.diff.bind(this),
      log: this.log.bind(this),
    }
  }

  public async read(path: string): Promise<Uint8Array> {
    await this.ensureActive()
    await this.touch()
    if (this.metadata.touchedFiles.includes(path)) {
      return this.adapter.readFromEphemeral(this.metadata.id, path)
    }
    return this.adapter.readFromDurableAtSha(this.durablePath, this.metadata.baselineSha, path)
  }

  public async write(path: string, bytes: Uint8Array): Promise<void> {
    await this.ensureActive()
    await this.adapter.writeToEphemeral(this.metadata.id, path, bytes)
    await this.markTouched(path)
    this.owner.emit('session.write', { sessionId: this.metadata.id, path })
  }

  public async delete(path: string): Promise<void> {
    await this.ensureActive()
    await this.adapter.deleteFromEphemeral(this.metadata.id, path)
    await this.markTouched(path)
    this.owner.emit('session.write', { sessionId: this.metadata.id, path, op: 'delete' })
  }

  public async commit(message: string): Promise<string> {
    await this.ensureActive()
    const sha = await this.adapter.commitEphemeral(this.metadata.id, message)
    await this.touch()
    this.owner.emit('session.commit', { sessionId: this.metadata.id, sha })
    return sha
  }

  public async writeAndCommit(opts: { files: Record<string, Uint8Array>; message: string }): Promise<string> {
    await this.ensureActive()
    for (const [path, bytes] of Object.entries(opts.files)) {
      await this.adapter.writeToEphemeral(this.metadata.id, path, bytes)
      await this.markTouched(path)
    }
    return this.commit(opts.message)
  }

  public async list(path = '.'): Promise<ListEntry[]> {
    await this.ensureActive()
    await this.touch()
    const baseline = await this.adapter.listDurableAtSha(this.durablePath, this.metadata.baselineSha, path)
    const ephemeral = await this.adapter.listEphemeral(this.metadata.id, path)

    const baselineMap = new Map(baseline.map((entry) => [entry.path, entry]))
    const ephemeralMap = new Map(ephemeral.map((entry) => [entry.path, entry]))

    for (const touched of this.metadata.touchedFiles) {
      const exists = await this.adapter.pathExistsInEphemeral(this.metadata.id, touched)
      if (!exists) {
        baselineMap.delete(touched)
        ephemeralMap.delete(touched)
      }
    }

    for (const [key, value] of ephemeralMap.entries()) {
      baselineMap.set(key, value)
    }

    return [...baselineMap.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  public async diff(): Promise<string> {
    await this.ensureActive()
    await this.touch()
    return this.adapter.diffEphemeral(this.metadata.id, this.metadata.baselineSha)
  }

  public async log(): Promise<CommitEntry[]> {
    await this.ensureActive()
    await this.touch()
    return this.adapter.logEphemeral(this.metadata.id)
  }

  public async promote(opts: PromoteOpts): Promise<PromoteResult> {
    await this.ensureActive()
    const selectedFiles = this.resolveSelectedFiles(opts)
    if (selectedFiles.length === 0) {
      throw new PromoteFailedError('staging', new Error('No selected files to promote'))
    }

    const currentDurableHead = await this.adapter.getDurableHead(this.durablePath, this.durableBranch)
    if (currentDurableHead !== this.metadata.baselineSha) {
      const changed = await this.adapter.changedFilesBetween(this.durablePath, this.metadata.baselineSha, currentDurableHead)
      const overlap = changed.filter((file) => selectedFiles.includes(file))
      if (overlap.length > 0) {
        throw new BaselineConflictError({
          conflictingFiles: overlap,
          durableSha: currentDurableHead,
          baselineSha: this.metadata.baselineSha,
        })
      }
    }

    const message = opts.message?.trim() || this.defaultPromoteMessage()
    try {
      const result = await withSessionLock(this.store.lockPath(this.metadata.id), this.metadata.id, async () =>
        this.adapter.applyToDurable({
          sessionId: this.metadata.id,
          files: selectedFiles,
          message,
        }),
      )

      const now = new Date().toISOString()
      this.metadata.promote = {
        strategy: opts.strategy ?? 'auto',
        result,
      }
      this.metadata.state = 'promoted'
      this.metadata.updatedAt = now
      this.metadata.lastAccessAt = now
      await this.store.writeMetadata(this.metadata)
      this.owner.emit('session.promote', { sessionId: this.metadata.id, result })

      if (this.metadata.evictionPolicy.untilPromote) {
        await this.owner.evict(this.metadata.id, 'promoted')
      }

      return result
    } catch (error) {
      if (error instanceof BaselineConflictError || error instanceof PromoteFailedError) {
        throw error
      }
      throw new PromoteFailedError('apply', error as Error)
    }
  }

  public async discard(): Promise<void> {
    await this.ensureActive()
    await this.owner.evict(this.metadata.id, 'discarded')
  }

  public async extend(ttlMs: number): Promise<void> {
    await this.ensureActive()
    this.metadata.evictionPolicy.ttlIdleMs = ttlMs
    await this.touch()
  }

  private async touch(): Promise<void> {
    const now = new Date().toISOString()
    this.metadata.updatedAt = now
    this.metadata.lastAccessAt = now
    await this.store.writeMetadata(this.metadata)
  }

  private async markTouched(path: string): Promise<void> {
    if (!this.metadata.touchedFiles.includes(path)) {
      this.metadata.touchedFiles.push(path)
    }
    await this.touch()
  }

  private resolveSelectedFiles(opts: PromoteOpts): string[] {
    if (opts.selector.mode === 'all') {
      return [...this.metadata.touchedFiles]
    }
    const touched = new Set(this.metadata.touchedFiles)
    return opts.selector.files.filter((file) => touched.has(file))
  }

  private defaultPromoteMessage(): string {
    const task = this.metadata.task.trim()
    if (task.length > 0) {
      return `gittrix: ${task}`
    }
    return `gittrix: promote session ${this.metadata.id}`
  }

  private async ensureActive(): Promise<void> {
    if (this.metadata.state !== 'active') {
      throw new SessionExpiredError(this.metadata.id, this.metadata.state)
    }
  }

  private get durablePath(): string {
    return parseLocalRefUri(this.metadata.durableRef).path
  }

  private get durableBranch(): string {
    return parseLocalRefUri(this.metadata.durableRef).branch ?? 'main'
  }
}
