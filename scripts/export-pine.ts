import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generatePine } from '../lib/strategy/pine'
import { CLIENT_DEFAULTS } from '../lib/strategy/config'

const destination = join(process.cwd(), 'public', 'strategies')
mkdirSync(destination, { recursive: true })
for (const kind of ['strategy', 'indicator'] as const) {
  writeFileSync(join(destination, `evo-iilf-${kind}.pine`), generatePine(CLIENT_DEFAULTS, kind))
}
