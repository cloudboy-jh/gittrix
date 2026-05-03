import { spawn } from 'node:child_process'
import layout from '../layout.json' with { type: 'json' }

const args = process.argv.slice(2)
const prefix = 'HAR'.slice(0, Math.max(1, layout.prefixLength))
let colorIndex = 0

if (args.includes('--typecheck')) {
  log('mode typecheck')
  await run(['run', 'typecheck'])
  process.exit(0)
}

if (args.includes('--all')) {
  log('mode all')
  await run(['test'])
  process.exit(0)
}

if (args.includes('--integration')) {
  log('mode integration')
  await run(['test', 'src/integration.test.ts'])
  process.exit(0)
}

log('mode local')
await run(['test', 'src/local.test.ts'])

async function run(bunArgs: string[]): Promise<void> {
  log(`bun ${bunArgs.join(' ')}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bun', bunArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(`bun ${bunArgs.join(' ')} failed with code ${code}`))
        return
      }
      resolve()
    })
  })
}

function log(message: string): void {
  const stageColor = layout.colors[colorIndex % layout.colors.length] ?? 'cyan'
  colorIndex += 1
  const left = colorize(`[${prefix}]`, layout.prefixColor)
  const right = colorize(message, stageColor)
  process.stdout.write(`${left} ${right}\n`)
}

function colorize(text: string, color: string): string {
  const code = ansiColorCode(color)
  return code ? `\u001b[${code}m${text}\u001b[0m` : text
}

function ansiColorCode(color: string): string {
  switch (color) {
    case 'blue':
      return '34'
    case 'pink':
      return '95'
    case 'green':
      return '32'
    case 'cyan':
      return '36'
    case 'yellow':
      return '33'
    default:
      return ''
  }
}
