import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, 'public/pdfjs'), { recursive: true })
for (const name of ['cmaps', 'standard_fonts']) {
  cpSync(resolve(root, 'node_modules/pdfjs-dist', name), resolve(root, 'public/pdfjs', name), { recursive: true })
}
