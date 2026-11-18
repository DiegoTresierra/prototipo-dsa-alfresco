import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const backendRoot = path.join(projectRoot, 'backend')
for (const environmentPath of [
  path.join(backendRoot, '.env.local'),
  path.join(projectRoot, '.env.local'),
  path.join(backendRoot, '.env'),
  path.join(projectRoot, '.env'),
]) {
  if (fs.existsSync(environmentPath)) dotenv.config({ path: environmentPath, override: false })
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required server configuration: ${name}`)
  return value
}

function parseJson(name, fallback) {
  const value = process.env[name]
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Invalid JSON configuration: ${name}`)
  }
}

function canonicalizeMappingKeys(mapping, aliases) {
  return Object.fromEntries(Object.entries(mapping).map(([key, configuredGroups]) => {
    const normalizedKey = String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const groupIds = Array.isArray(configuredGroups) ? configuredGroups : [configuredGroups]
    const normalizedGroups = groupIds.map((group) => {
      if (group && typeof group === 'object') return group.id || group.groupId || group.name || ''
      return group
    }).filter(Boolean)
    return [aliases[normalizedKey] || key, normalizedGroups.length === 1 ? normalizedGroups[0] : normalizedGroups]
  }))
}

function normalizeGroupMappings(dependencies, functions) {
  return {
    dependencies: canonicalizeMappingKeys(dependencies, { dti: 'DTI', gddti: 'DTI', dsa: 'DSA', gddsa: 'DSA' }),
    functions: canonicalizeMappingKeys(functions, {
      director: 'direccion',
      direccion: 'direccion',
      jefeunidad: 'jefe-unidad',
      especialista: 'especialista',
    }),
  }
}

function parseGroupMappings() {
  if (process.env.ALFRESCO_GROUP_MAPPINGS_JSON) {
    const mappings = parseJson('ALFRESCO_GROUP_MAPPINGS_JSON', {})
    return normalizeGroupMappings(mappings.dependencies || {}, mappings.functions || {})
  }

  const dependencies = parseJson('ALFRESCO_DEPENDENCY_GROUP_MAPPINGS_JSON', {})
  const functions = parseJson('ALFRESCO_ROLE_MAPPINGS_JSON', {})
  if (Object.keys(dependencies).length || Object.keys(functions).length) return normalizeGroupMappings(dependencies, functions)

  return { dependencies: {}, functions: {} }
}

export function dispatchPilotSettings(environment = process.env) {
  return {
    writesEnabled: environment.DISPATCH_ALFRESCO_WRITES_ENABLED === 'true',
    environment: environment.DISPATCH_PILOT_ENVIRONMENT || '',
    environments: {
      dev: {
        enabled: true,
        acknowledgement: environment.DISPATCH_PILOT_ACK || '',
        expectedTarget: environment.DISPATCH_PILOT_ALFRESCO_TARGET || '',
      },
      preprod: {
        enabled: environment.DISPATCH_PREPROD_WRITES_ENABLED === 'true',
        acknowledgement: environment.DISPATCH_PREPROD_ACK || '',
        expectedTarget: environment.DISPATCH_PREPROD_ALFRESCO_TARGET || '',
      },
    },
    leasePath: environment.DISPATCH_PILOT_LEASE_PATH || path.join(backendRoot, 'data', 'dispatch-pilot.lock'),
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: required('SESSION_SECRET'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  alfrescoTarget: required('ALFRESCO_TARGET').replace(/\/+$/, ''),
  alfrescoDiagnostics: process.env.ALFRESCO_DIAGNOSTICS === 'true',
  basicAuthEnabled: process.env.ALFRESCO_BASIC_AUTH_ENABLED !== 'false',
  ssoAuthMode: process.env.ALFRESCO_SSO_AUTH_MODE || 'bearer',
  groupMappings: parseGroupMappings(),
  userInboxNodeIds: parseJson('ALFRESCO_USER_INBOX_NODE_IDS_JSON', {}),
  officeInboxNodeIds: parseJson('ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON', {}),
  officeGroupIds: parseJson('ALFRESCO_OFFICE_GROUP_IDS_JSON', { DTI: 'GROUP_GD_DTI', DSA: 'GROUP_GD_DSA' }),
  dispatchStorePath: process.env.DISPATCH_STORE_PATH || path.join(backendRoot, 'data', 'dispatches.json'),
  dispatchPersistence: process.env.DISPATCH_PERSISTENCE || 'alfresco',
  dispatchPilot: dispatchPilotSettings(),
  numberingStorePath: process.env.NUMBERING_STORE_PATH || path.join(backendRoot, 'data', 'document-numbers.json'),
  organizationStorePath: process.env.ORGANIZATION_STORE_PATH || path.join(backendRoot, 'data', 'organization.json'),
  distributionService: {
    username: process.env.ALFRESCO_DISTRIBUTION_SERVICE_USERNAME || process.env.ALFRESCO_DISTRIBUTION_USERNAME || '',
    password: process.env.ALFRESCO_DISTRIBUTION_SERVICE_USERNAME
      ? process.env.ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD || ''
      : process.env.ALFRESCO_DISTRIBUTION_PASSWORD || '',
  },
  userUnitAssignments: parseJson('ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON', {}),
  keycloak: {
    issuer: required('KEYCLOAK_ISSUER'),
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || undefined,
    redirectUri: required('KEYCLOAK_REDIRECT_URI'),
  },
}
