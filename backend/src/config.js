import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env.local'),
    path.join(projectRoot, '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.join(projectRoot, '.env'),
  ],
})

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

const defaultOfficeInboxNodeIds = {
  DTI: {
    emitidos: '69e39272-905e-426c-a392-72905ef26ca6',
    porAtender: 'e9b77e3e-9194-4156-b77e-3e9194015606',
    porConocimiento: '8dbbdbbd-853b-43c2-bbdb-bd853b33c290',
  },
  DSA: {
    emitidos: '0bbf2022-7bbb-40a9-bf20-227bbb00a929',
    porAtender: '701049e5-a6a9-48c0-9049-e5a6a998c02b',
    porConocimiento: '2cffb358-2e6f-40f2-bfb3-582e6f40f27f',
  },
}

const defaultOfficeGroupIds = { DTI: 'GROUP_GD_DTI', DSA: 'GROUP_GD_DSA' }

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

const defaultGroupMappings = {
  dependencies: { DTI: 'GROUP_GD_DTI', DSA: 'GROUP_GD_DSA' },
  functions: {
    direccion: 'GROUP_GD_DIRECCION',
    'jefe-unidad': 'GROUP_GD_JEFE_UNIDAD',
    especialista: 'GROUP_GD_ESPECIALISTA',
  },
}

function parseGroupMappings() {
  if (process.env.ALFRESCO_GROUP_MAPPINGS_JSON) {
    const mappings = parseJson('ALFRESCO_GROUP_MAPPINGS_JSON', {})
    return normalizeGroupMappings(mappings.dependencies || {}, mappings.functions || {})
  }

  const dependencies = parseJson('ALFRESCO_DEPENDENCY_GROUP_MAPPINGS_JSON', {})
  const functions = parseJson('ALFRESCO_ROLE_MAPPINGS_JSON', {})
  if (Object.keys(dependencies).length || Object.keys(functions).length) return normalizeGroupMappings(dependencies, functions)

  return defaultGroupMappings
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
  officeInboxNodeIds: parseJson('ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON', defaultOfficeInboxNodeIds),
  officeGroupIds: parseJson('ALFRESCO_OFFICE_GROUP_IDS_JSON', defaultOfficeGroupIds),
  userUnitAssignments: parseJson('ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON', {}),
  distributionService: {
    username: process.env.ALFRESCO_DISTRIBUTION_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD || '',
  },
  capabilitiesByFunction: parseJson('ALFRESCO_CAPABILITIES_BY_FUNCTION_JSON', {
    direccion: ['documents:read', 'documents:write', 'documents:emit'],
    'jefe-unidad': ['documents:read', 'documents:attend'],
    especialista: ['documents:read', 'documents:attend'],
  }),
  keycloak: {
    issuer: required('KEYCLOAK_ISSUER'),
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || undefined,
    redirectUri: required('KEYCLOAK_REDIRECT_URI'),
  },
}
