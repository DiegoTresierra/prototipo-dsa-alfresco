import fs from 'node:fs'
import { config } from '../src/config.js'
import { createHierarchyRepository } from '../src/hierarchyRepository.js'
import { createHierarchyAuditRepository } from '../src/hierarchyAuditRepository.js'
import { createHierarchyDirectory } from '../src/hierarchyDirectory.js'
import { readPendingHierarchyOperations } from '../src/institutionalHierarchyProvider.js'
import { hierarchyPilotConfigurationReady } from '../src/hierarchyPilot.js'

const repository = createHierarchyRepository(config)
const audit = createHierarchyAuditRepository(config)
const directory = createHierarchyDirectory(config)
try {
  const [container, auditContainer, units, assignments, pending, director, heads, specialists] = await Promise.all([
    repository.getContainer(), audit.getContainer(),
    repository.listUnits({ dependency: 'DSA' }),
    repository.listAssignments({ dependency: 'DSA' }),
    readPendingHierarchyOperations(audit, 'DSA'),
    directory.validateAssignmentCandidate('DSA_T', { dependency: 'DSA', role: 'direccion' }),
    directory.listCandidates({ dependency: 'DSA', role: 'jefe-unidad' }),
    directory.listCandidates({ dependency: 'DSA', role: 'especialista' }),
  ])
  const unitPermissions = await Promise.all(units.units.map(unit =>
    repository.getUnitAllowableOperations(unit.id, 'DSA')))
  console.log(JSON.stringify({
    configuredForDsaPilot: hierarchyPilotConfigurationReady(config),
    leaseFilePresent: fs.existsSync(config.hierarchyPilot.leasePath),
    hierarchyContainerCreate: container.allowableOperations?.includes('create') === true,
    auditContainerCreate: auditContainer.allowableOperations?.includes('create') === true,
    activeUnits: units.units.filter(item => item.status === 'ACTIVA').length,
    unitsAllowChildCreation: unitPermissions.every(operations => operations.includes('create')),
    unitsAllowUpdate: unitPermissions.every(operations => operations.includes('update')),
    activeHeads: assignments.assignments.filter(item => item.status === 'ACTIVA' && item.role === 'jefe-unidad').length,
    activeSpecialists: assignments.assignments.filter(item => item.status === 'ACTIVA' && item.role === 'especialista').length,
    directorDsaValid: director.id === 'DSA_T' && director.enabled === true,
    eligibleHeads: heads.length,
    eligibleSpecialists: specialists.length,
    pendingHierarchyOperations: pending.length,
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.code || 'HIERARCHY_PILOT_READ_UNAVAILABLE' }))
  process.exitCode = 1
}
