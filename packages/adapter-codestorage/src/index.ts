import type { AdapterCapabilities, DurableAdapter, EphemeralAdapter, ListEntry } from '@gittrix/core'
import { AdapterUnavailableError } from '@gittrix/core'

const unavailableMessage = 'Code Storage adapter pending early access'

const codeStorageCapabilities: AdapterCapabilities = {
  git: true,
  push: true,
  fetch: true,
  history: true,
  ttl: true,
  latencyClass: 'edge',
}

export interface CodeStorageDurableOptions {
  namespace: string
  repo: string
  branch?: string
}

export interface CodeStorageEphemeralOptions {
  namespace: string
}

export class CodeStorageDurableAdapter implements DurableAdapter {
  public constructor(private readonly _options: CodeStorageDurableOptions) {}

  public capabilities(): AdapterCapabilities {
    return codeStorageCapabilities
  }

  public async getHead(_branch: string): Promise<string> {
    throw unavailable()
  }

  public async readAtSha(_sha: string, _path: string): Promise<Uint8Array> {
    throw unavailable()
  }

  public async listAtSha(_sha: string, _path?: string): Promise<ListEntry[]> {
    throw unavailable()
  }

  public async changedFilesBetween(_fromSha: string, _toSha: string): Promise<string[]> {
    throw unavailable()
  }

  public async applyCommit(_opts: {
    files: Record<string, Uint8Array | null>
    message: string
    branch?: string
  }): Promise<{ sha: string; branch: string }> {
    throw unavailable()
  }
}

export class CodeStorageEphemeralAdapter implements EphemeralAdapter {
  public constructor(private readonly _options: CodeStorageEphemeralOptions) {}

  public capabilities(): AdapterCapabilities {
    return codeStorageCapabilities
  }

  public async initWorkspace(_sessionId: string, _baseline: { durableRef: string; sha: string }): Promise<void> {
    throw unavailable()
  }

  public async read(_sessionId: string, _path: string): Promise<Uint8Array> {
    throw unavailable()
  }

  public async write(_sessionId: string, _path: string, _bytes: Uint8Array): Promise<void> {
    throw unavailable()
  }

  public async delete(_sessionId: string, _path: string): Promise<void> {
    throw unavailable()
  }

  public async exists(_sessionId: string, _path: string): Promise<boolean> {
    throw unavailable()
  }

  public async list(_sessionId: string, _path?: string): Promise<ListEntry[]> {
    throw unavailable()
  }

  public async touchedFiles(_sessionId: string): Promise<string[]> {
    throw unavailable()
  }

  public async destroy(_sessionId: string): Promise<void> {
    throw unavailable()
  }
}

function unavailable(): AdapterUnavailableError {
  return new AdapterUnavailableError(unavailableMessage)
}
