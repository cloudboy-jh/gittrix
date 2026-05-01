import { AuthError } from '@gittrix/core'

export interface ArtifactsClientOptions {
  accountId: string
  apiToken: string
  namespace?: string
}

interface CfEnvelope<T> {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result: T
}

export class ArtifactsApiError extends Error {
  public readonly code: number
  public constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export class ArtifactsClient {
  private readonly accountId: string
  private readonly apiToken: string
  private readonly namespace: string

  public constructor(opts: ArtifactsClientOptions) {
    this.accountId = opts.accountId
    this.apiToken = opts.apiToken
    this.namespace = opts.namespace ?? 'default'
  }

  public async createRepo(name: string): Promise<{ id: string; remote: string; token: string; expires_at: string }> {
    return this.request('POST', '/repos', { name })
  }

  public async getRepo(name: string): Promise<{ id: string; name: string; remote: string; default_branch: string }> {
    return this.request('GET', `/repos/${encodeURIComponent(name)}`)
  }

  public async deleteRepo(name: string): Promise<void> {
    await this.request('DELETE', `/repos/${encodeURIComponent(name)}`)
  }

  public async mintToken(repoName: string): Promise<{ token: string; expires_at: string }> {
    return this.request('POST', `/repos/${encodeURIComponent(repoName)}/tokens`)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }
    const response = await fetch(`${this.baseUrl()}${path}`, init)

    if (response.status === 401 || response.status === 403) {
      throw new AuthError('Cloudflare Artifacts authentication failed')
    }

    const data = (await response.json()) as CfEnvelope<T>
    if (!response.ok || !data.success) {
      const first = data.errors?.[0]
      throw new ArtifactsApiError(first?.code ?? response.status, first?.message ?? 'Cloudflare API request failed')
    }
    return data.result
  }

  private baseUrl(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/artifacts/namespaces/${this.namespace}`
  }
}
