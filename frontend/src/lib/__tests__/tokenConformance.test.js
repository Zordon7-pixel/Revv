import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const frontendRoot = process.cwd()
const tokenizedFiles = [
  'src/pages/Login.jsx',
  'src/pages/Register.jsx',
  'src/pages/ResetPassword.jsx',
  'src/pages/Terms.jsx',
  'src/pages/Privacy.jsx',
  'src/pages/SmsTerms.jsx',
  'src/components/ErrorBoundary.jsx',
]

function read(relativePath) {
  return readFileSync(resolve(frontendRoot, relativePath), 'utf8')
}

describe('redesign token conformance', () => {
  it('keeps migrated auth, legal, and fallback surfaces off raw and legacy palettes', () => {
    for (const relativePath of tokenizedFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via)-(?:indigo|blue|slate|yellow)-/)
      expect(source, relativePath).not.toMatch(/bg-gradient-/)
    }
  })

  it('uses the shared REVV mark on authentication surfaces', () => {
    for (const relativePath of ['src/pages/Login.jsx', 'src/pages/Register.jsx', 'src/pages/ResetPassword.jsx']) {
      const source = read(relativePath)
      expect(source, relativePath).toMatch(/import \{ Logo \} from '\.\.\/components\/ui'/)
      expect(source, relativePath).toMatch(/<Logo variant="mark"/)
    }
  })

  it('keeps the unmounted legacy customer portal removed', () => {
    expect(existsSync(resolve(frontendRoot, 'src/pages/Portal.jsx'))).toBe(false)
    expect(read('src/App.jsx')).not.toMatch(/\.\/pages\/Portal/)
  })
})
