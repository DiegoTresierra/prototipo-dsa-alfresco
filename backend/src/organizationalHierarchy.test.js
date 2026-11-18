import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveManagedRecipients } from './organizationalHierarchy.js'

const head = { functionalRole: 'jefe-unidad', dependency: 'DSA', alfresco: { id: 'head' } }
const recipients = [
  { id: 'a', dependency: 'dsa', functionalRole: 'especialista' },
  { id: 'b', dependency: 'dsa', functionalRole: 'especialista' },
  { id: 'c', dependency: 'dti', functionalRole: 'especialista' },
  { id: 'h', dependency: 'dsa', functionalRole: 'jefe-unidad' },
]
test('missing hierarchy blocks head instead of assigning every dependency specialist', async () => {
  await assert.rejects(resolveManagedRecipients(head, recipients), { message: 'ORGANIZATIONAL_HIERARCHY_PENDING', status: 503 })
})
test('trusted provider is intersected with institutional dependency and enabled directory', async () => {
  const result = await resolveManagedRecipients(head, recipients, {
    async resolveSpecialists(input) {
      assert.deepEqual(input, { userId: 'head', dependency: 'dsa' })
      return { verified: true, members: ['a', 'c', 'h', 'missing'].map((userId) => ({ userId, groupIds: ['GROUP_verified'] })) }
    },
  })
  assert.deepEqual(result.map((person) => person.id), ['a'])
  await assert.rejects(resolveManagedRecipients(head, recipients, { resolveSpecialists: async () => ({ verified: false }) }), /ORGANIZATIONAL_HIERARCHY_PENDING/)
})
test('Direction retains institutional scope; specialist cannot derive', async () => {
  assert.deepEqual((await resolveManagedRecipients({ ...head, functionalRole: 'direccion' }, recipients)).map((p) => p.id), ['a', 'b', 'h'])
  assert.deepEqual(await resolveManagedRecipients({ ...head, functionalRole: 'especialista' }, recipients), [])
})
