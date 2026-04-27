import type { Ref } from './types.js'

export function toRefUri(ref: Ref): string {
  switch (ref.type) {
    case 'local': {
      const branch = ref.branch ? `#${ref.branch}` : ''
      return `local://${normalizeLocalPath(ref.path)}${branch}`
    }
    case 'github': {
      const branch = ref.branch ? `#${ref.branch}` : ''
      return `github://${ref.owner}/${ref.repo}${branch}`
    }
    case 'codestorage': {
      const branch = ref.branch ? `#${ref.branch}` : ''
      return `codestorage://${ref.namespace}/${ref.repo}${branch}`
    }
    case 'cloudflare':
      return `cloudflare://${ref.namespace}/${ref.key}`
    case 'gitfork':
      return `gitfork://${ref.slug}`
  }
}

export function parseLocalRefUri(uri: string): { path: string; branch: string | null } {
  if (!uri.startsWith('local://')) {
    throw new Error(`Not a local ref URI: ${uri}`)
  }
  const withoutScheme = uri.slice('local://'.length)
  const hashIndex = withoutScheme.indexOf('#')
  const rawPath = hashIndex === -1 ? withoutScheme : withoutScheme.slice(0, hashIndex)
  const branch = hashIndex === -1 ? null : withoutScheme.slice(hashIndex + 1)
  let path = rawPath
  if (/^\/[A-Za-z]:\//.test(rawPath)) {
    path = rawPath.slice(1)
  }
  return { path, branch }
}

function normalizeLocalPath(path: string): string {
  if (/^[A-Za-z]:/.test(path)) {
    return `/${path.replace(/\\/g, '/')}`
  }
  return path
}
