export type Ref =
  | { type: 'local'; path: string; branch?: string }
  | { type: 'github'; owner: string; repo: string; branch?: string }
  | { type: 'codestorage'; namespace: string; repo: string; branch?: string }
  | { type: 'cloudflare'; namespace: string; key: string }
  | { type: 'gitfork'; slug: string }

export interface AdapterCapabilities {
  git: boolean
  push: boolean
  fetch: boolean
  history: boolean
  ttl: boolean
  maxBlobSize?: number
  latencyClass: 'local' | 'edge' | 'regional'
}

export type SessionState = 'active' | 'promoted' | 'discarded' | 'expired'

export interface EvictionPolicy {
  ttlIdleMs: number | null
  ttlAbsoluteMs: number | null
  untilPromote: boolean
  manual: boolean
}

export interface PromoteSelectorAll {
  mode: 'all'
}

export interface PromoteSelectorFiles {
  mode: 'files'
  files: string[]
}

export type PromoteSelector = PromoteSelectorAll | PromoteSelectorFiles

export type PromoteStrategy = 'auto' | 'commit' | 'branch' | 'pr' | 'patch'

export interface PromoteOpts {
  selector: PromoteSelector
  strategy?: PromoteStrategy
  message?: string
}

export interface PromoteResult {
  sha: string
  branch: string
  prUrl?: string
}

export interface SessionMetadata {
  metadataVersion: 1
  id: string
  task: string
  durableRef: string
  ephemeralRef: string
  baselineSha: string
  state: SessionState
  createdAt: string
  updatedAt: string
  lastAccessAt: string
  evictionPolicy: EvictionPolicy
  touchedFiles: string[]
  promote: {
    strategy: PromoteStrategy
    result: PromoteResult | null
  }
}

export interface CommitEntry {
  sha: string
  authorName: string
  authorEmail: string
  timestamp: string
  message: string
}

export interface ListEntry {
  path: string
  type: 'file' | 'dir'
}

export interface ApplyToDurableOpts {
  sessionId: string
  files: string[]
  message: string
}

export interface ApplyToDurableResult {
  sha: string
  branch: string
}

export interface SessionInit {
  sessionId: string
  durablePath: string
  durableBranch?: string
  ephemeralPath: string
}

export interface LocalSessionAdapter {
  capabilities(): AdapterCapabilities
  initFromDurable(opts: SessionInit): Promise<void>
  restoreSession(opts: SessionInit): Promise<void>
  getDurableHead(durablePath: string, branch?: string): Promise<string>
  getEphemeralHead(sessionId: string): Promise<string>
  readFromEphemeral(sessionId: string, path: string): Promise<Uint8Array>
  readFromDurableAtSha(durablePath: string, sha: string, path: string): Promise<Uint8Array>
  writeToEphemeral(sessionId: string, path: string, bytes: Uint8Array): Promise<void>
  deleteFromEphemeral(sessionId: string, path: string): Promise<void>
  pathExistsInEphemeral(sessionId: string, path: string): Promise<boolean>
  listEphemeral(sessionId: string, path?: string): Promise<ListEntry[]>
  listDurableAtSha(durablePath: string, sha: string, path?: string): Promise<ListEntry[]>
  commitEphemeral(sessionId: string, message: string): Promise<string>
  diffEphemeral(sessionId: string, fromSha?: string): Promise<string>
  logEphemeral(sessionId: string): Promise<CommitEntry[]>
  changedFilesBetween(durablePath: string, fromSha: string, toSha: string): Promise<string[]>
  applyToDurable(opts: ApplyToDurableOpts): Promise<ApplyToDurableResult>
  destroy(sessionId: string): Promise<void>
}

export interface StartSessionOpts {
  task: string
  durablePath: string
  durableBranch?: string
  eviction?: Partial<EvictionPolicy>
}

export interface AgentSession {
  read(path: string): Promise<Uint8Array>
  write(path: string, bytes: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  commit(message: string): Promise<string>
  writeAndCommit(opts: { files: Record<string, Uint8Array>; message: string }): Promise<string>
  list(path?: string): Promise<ListEntry[]>
  diff(): Promise<string>
  log(): Promise<CommitEntry[]>
}

export interface UserSession extends AgentSession {
  promote(opts: PromoteOpts): Promise<PromoteResult>
  discard(): Promise<void>
  extend(ttlMs: number): Promise<void>
  forAgent(): AgentSession
}
