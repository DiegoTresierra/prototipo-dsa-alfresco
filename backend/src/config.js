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
  officeGroupIds: parseJson('ALFRESCO_OFFICE_GROUP_IDS_JSON', {}),
  userUnitAssignments: parseJson('ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON', {}),
  distributionService: {
    username: process.env.ALFRESCO_DISTRIBUTION_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD || '',
  },
  capabilitiesByFunction: parseJson('ALFRESCO_CAPABILITIES_BY_FUNCTION_JSON', {}),
  keycloak: {
    issuer: required('KEYCLOAK_ISSUER'),
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || undefined,
    redirectUri: required('KEYCLOAK_REDIRECT_URI'),
  },
}
