export class GittrixError extends Error {
  public readonly code: string

  public constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = this.constructor.name
  }
}

export class AdapterUnavailableError extends GittrixError {
  public constructor(message = 'Adapter unavailable') {
    super('ADAPTER_UNAVAILABLE', message)
  }
}

export class AuthError extends GittrixError {
  public constructor(message = 'Authentication failed') {
    super('AUTH_FAILED', message)
  }
}

export class CapabilityMissingError extends GittrixError {
  public constructor(message = 'Adapter capability missing') {
    super('CAPABILITY_MISSING', message)
  }
}

export class SessionNotFoundError extends GittrixError {
  public constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `Session not found: ${sessionId}`)
  }
}

export class SessionExpiredError extends GittrixError {
  public constructor(sessionId: string, state: string) {
    super('SESSION_EXPIRED', `Session ${sessionId} is not active (state=${state})`)
  }
}

export class BaselineConflictError extends GittrixError {
  public readonly conflictingFiles: string[]
  public readonly durableSha: string
  public readonly baselineSha: string

  public constructor(opts: { conflictingFiles: string[]; durableSha: string; baselineSha: string }) {
    super('BASELINE_CONFLICT', 'Durable baseline moved with overlapping files')
    this.conflictingFiles = opts.conflictingFiles
    this.durableSha = opts.durableSha
    this.baselineSha = opts.baselineSha
  }
}

export class PromoteFailedError extends GittrixError {
  public readonly stage: 'staging' | 'apply' | 'cleanup'
  public readonly cause: Error

  public constructor(stage: 'staging' | 'apply' | 'cleanup', cause: Error) {
    super('PROMOTE_FAILED', `Promotion failed during ${stage}: ${cause.message}`)
    this.stage = stage
    this.cause = cause
  }
}

export class WriteRejectedError extends GittrixError {
  public constructor(message = 'Write rejected') {
    super('WRITE_REJECTED', message)
  }
}

export class EvictionRaceError extends GittrixError {
  public constructor(sessionId: string) {
    super('EVICTION_RACE', `Session lock busy: ${sessionId}`)
  }
}

export class MetadataVersionError extends GittrixError {
  public constructor(version: unknown) {
    super('METADATA_VERSION_UNSUPPORTED', `Unsupported metadata version: ${String(version)}`)
  }
}
