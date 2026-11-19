import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test('production React components remain UTF-8 without corrupted Spanish literals', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? visit(path.join(directory, entry.name)) : entry.name.endsWith('.jsx') ? [path.join(directory, entry.name)] : [])
  for (const file of visit(root)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file))
    assert.doesNotMatch(text, /\uFFFD|Direcci\?n|c\?digo|verificaci\?n|subordinaci\?n|Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â€/, file)
  }
  const form = fs.readFileSync(path.join(root, 'components', 'DocumentForm.jsx'), 'utf8')
  assert.match(form, /title: 'Dirección'/)
  assert.match(form, /código institucional pendientes de verificación/)
  assert.match(form, /recipient\.displayName\} · \{recipient\.id\}/)
})
