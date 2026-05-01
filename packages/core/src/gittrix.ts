import { EventEmitter } from 'node:events'

import { nanoid } from 'nanoid'

import { computeDiff } from './diff.js'
import { BaselineConflictError, CapabilityMissingError, PromoteFailedError, SessionExpiredError } from './errors.js'
import { withSessionLock } from './lock.js'
import { parseLocalRefUri, toRefUri } from './ref.js'
import { SessionStore } from './session-store.js'
import type {
  AgentSession,
  CommitEntry,
  DurableAdapter,
  EphemeralAdapter,
  EvictionPolicy,
  ListEntry,
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
  durable: DurableAdapter
  ephemeral: EphemeralAdapter
  storeDir?: string
  defaultEviction?: Partial<EvictionPolicy>
  evictionSweepIntervalMs?: number
}

export class GitTrix extends EventEmitter {
  private readonly durable: DurableAdapter
  private readonly ephemeral: EphemeralAdapter
  private readonly store: SessionStore
  private readonly defaultEviction: EvictionPolicy
  private readonly sweepIntervalMs: number
  private sweepTimer: NodeJS.Timeout | null = null

  public constructor(options: GitTrixOptions) {
    super()
    this.durable = options.durable
    this.ephemeral = options.ephemeral
    this.store = new SessionStore(options.storeDir)
    this.defaultEviction = { ...DEFAULT_EVICTION, ...options.defaultEviction }
    this.sweepIntervalMs = options.evictionSweepIntervalMs ?? 5 * 60 * 1000

    if (!this.durable.capabilities().git) {
      throw new CapabilityMissingError('Durable adapter requires git capability')
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
    const durableRef = toRefUri({ type: 'local', path: opts.durablePath, branch })
    const baselineSha = await this.durable.getHead(branch)
    await this.ephemeral.initWorkspace(id, { durableRef, sha: baselineSha })

    const metadata: SessionMetadata = {
      metadataVersion: 1,
      id,
      task: opts.task,
      durableRef,
      ephemeralRef: toRefUri({ type: 'local', path: this.store.workspacePath(id), branch }),
      baselineSha,
      state: 'active',
      createdAt: now,
      updatedAt: now,
      lastAccessAt: now,
      evictionPolicy: { ...this.defaultEviction, ...opts.eviction },
      touchedFiles: [],
      promote: { strategy: 'auto', result: null },
    }

    await this.store.writeMetadata(metadata)
    this.emit('session.start', { sessionId: id })
    return new GitTrixSession(this.durable, this.ephemeral, this.store, metadata, this)
  }

  public async getSession(sessionId: string): Promise<GitTrixSession> {
    const metadata = await this.store.readMetadata(sessionId)
    if (metadata.state !== 'active') {
      throw new SessionExpiredError(sessionId, metadata.state)
    }
    return new GitTrixSession(this.durable, this.ephemeral, this.store, metadata, this)
  }

  public async listSessions(): Promise<SessionMetadata[]> {
    return this.store.listMetadata()
  }

  public async evict(sessionId: string, state: 'expired' | 'discarded' | 'promoted' = 'expired'): Promise<void> {
    const metadata = await this.store.readMetadata(sessionId)
    await withSessionLock(this.store.lockPath(sessionId), sessionId, async () => {
      await this.ephemeral.destroy(sessionId)
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
      if (session.state !== 'active' || session.evictionPolicy.manual) {
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
  private readonly durable: DurableAdapter
  private readonly ephemeral: EphemeralAdapter
  private readonly store: SessionStore
  private metadata: SessionMetadata
  private readonly owner: GitTrix

  public constructor(
    durable: DurableAdapter,
    ephemeral: EphemeralAdapter,
    store: SessionStore,
    metadata: SessionMetadata,
    owner: GitTrix,
  ) {
    this.durable = durable
    this.ephemeral = ephemeral
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
    if (await this.ephemeral.exists(this.metadata.id, path)) {
      return this.ephemeral.read(this.metadata.id, path)
    }
    return this.durable.readAtSha(this.metadata.baselineSha, path)
  }

  public async write(path: string, bytes: Uint8Array): Promise<void> {
    await this.ensureActive()
    await this.ephemeral.write(this.metadata.id, path, bytes)
    await this.markTouched(path)
    this.owner.emit('session.write', { sessionId: this.metadata.id, path })
  }

  public async delete(path: string): Promise<void> {
    await this.ensureActive()
    await this.ephemeral.delete(this.metadata.id, path)
    await this.markTouched(path)
    this.owner.emit('session.write', { sessionId: this.metadata.id, path, op: 'delete' })
  }

  public async commit(_message: string): Promise<string> {
    await this.ensureActive()
    const sha = `ephemeral-${Date.now()}`
    await this.touch()
    this.owner.emit('session.commit', { sessionId: this.metadata.id, sha })
    return sha
  }

  public async writeAndCommit(opts: { files: Record<string, Uint8Array>; message: string }): Promise<string> {
    await this.ensureActive()
    for (const [path, bytes] of Object.entries(opts.files)) {
      await this.ephemeral.write(this.metadata.id, path, bytes)
      await this.markTouched(path)
    }
    return this.commit(opts.message)
  }

  public async list(path = '.'): Promise<ListEntry[]> {
    await this.ensureActive()
    await this.touch()
    const baseline = await this.durable.listAtSha(this.metadata.baselineSha, path)
    const ephemeral = await this.ephemeral.list(this.metadata.id, path)
    const baselineMap = new Map(baseline.map((entry) => [entry.path, entry]))
    for (const touched of await this.ephemeral.touchedFiles(this.metadata.id)) {
      if (!(await this.ephemeral.exists(this.metadata.id, touched))) {
        baselineMap.delete(touched)
      }
    }
    for (const e of ephemeral) {
      baselineMap.set(e.path, e)
    }
    return [...baselineMap.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  public async diff(): Promise<string> {
    await this.ensureActive()
    await this.touch()
    return computeDiff({
      ephemeral: this.ephemeral,
      durable: this.durable,
      sessionId: this.metadata.id,
      baselineSha: this.metadata.baselineSha,
    })
  }

  public async log(): Promise<CommitEntry[]> {
    await this.ensureActive()
    await this.touch()
    return []
  }

  public async promote(opts: PromoteOpts): Promise<PromoteResult> {
    await this.ensureActive()
    const touched = await this.ephemeral.touchedFiles(this.metadata.id)
    const selectedFiles = opts.selector.mode === 'all' ? touched : opts.selector.files.filter((f) => touched.includes(f))
    if (selectedFiles.length === 0) {
      throw new PromoteFailedError('staging', new Error('No selected files to promote'))
    }

    const currentHead = await this.durable.getHead(this.durableBranch)
    if (currentHead !== this.metadata.baselineSha) {
      const changed = await this.durable.changedFilesBetween(this.metadata.baselineSha, currentHead)
      const overlap = changed.filter((file) => selectedFiles.includes(file))
      if (overlap.length > 0) {
        throw new BaselineConflictError({
          conflictingFiles: overlap,
          durableSha: currentHead,
          baselineSha: this.metadata.baselineSha,
        })
      }
    }

    const files: Record<string, Uint8Array | null> = {}
    for (const path of selectedFiles) {
      files[path] = (await this.ephemeral.exists(this.metadata.id, path))
        ? await this.ephemeral.read(this.metadata.id, path)
        : null
    }

    const message = opts.message?.trim() || this.defaultPromoteMessage()
    try {
      const result = await withSessionLock(this.store.lockPath(this.metadata.id), this.metadata.id, async () =>
        this.durable.applyCommit({ files, message, branch: this.durableBranch }),
      )
      const now = new Date().toISOString()
      this.metadata.promote = { strategy: opts.strategy ?? 'auto', result }
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

  private defaultPromoteMessage(): string {
    const task = this.metadata.task.trim()
    return task.length > 0 ? `gittrix: ${task}` : `gittrix: promote session ${this.metadata.id}`
  }

  private async ensureActive(): Promise<void> {
    if (this.metadata.state !== 'active') {
      throw new SessionExpiredError(this.metadata.id, this.metadata.state)
    }
  }

  private get durableBranch(): string {
    return parseLocalRefUri(this.metadata.durableRef).branch ?? 'main'
  }
}
