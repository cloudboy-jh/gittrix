#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const failures = []

const packJsonRaw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
const packEntries = JSON.parse(packJsonRaw)
if (!Array.isArray(packEntries) || packEntries.length === 0) {
  throw new Error('npm pack did not return file metadata')
}

const tarFiles = new Set(packEntries[0].files.map((entry) => entry.path))

for (const [binName, binPath] of Object.entries(pkg.bin ?? {})) {
  const normalizedBinPath = binPath.startsWith('./') ? binPath.slice(2) : binPath
  if (!tarFiles.has(normalizedBinPath)) {
    failures.push(`Missing bin target for ${binName}: ${normalizedBinPath}`)
  }
}

const requiredMcpFiles = [
  'packages/mcp/dist/index.js',
  'packages/mcp/dist/index.d.ts',
]

for (const filePath of requiredMcpFiles) {
  if (!tarFiles.has(filePath)) {
    failures.push(`Packed tarball missing MCP artifact: ${filePath}`)
  }
}

for (const [depName, depVersion] of Object.entries(pkg.dependencies ?? {})) {
  try {
    execFileSync('npm', ['view', `${depName}@${depVersion}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    failures.push(`Unresolvable dependency: ${depName}@${depVersion}`)
  }
}

if (failures.length > 0) {
  console.error('Publish validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Publish validation passed')
console.log(`- checked bin entries: ${Object.keys(pkg.bin ?? {}).length}`)
console.log(`- checked MCP files: ${requiredMcpFiles.length}`)
console.log(`- checked dependencies: ${Object.keys(pkg.dependencies ?? {}).length}`)
