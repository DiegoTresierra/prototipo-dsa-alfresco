import { parseGroupMappings, distributionGroupIds } from './groupMappings.js'
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

const technicalUserIds = parseJson('ALFRESCO_TECHNICAL_USER_IDS_JSON', [])
if (!Array.isArray(technicalUserIds) || technicalUserIds.some(id => typeof id !== 'string' || !id.trim())) {
  throw new Error('Invalid configuration: ALFRESCO_TECHNICAL_USER_IDS_JSON')
}
const groupMappings = parseGroupMappings()
export const config = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: required('SESSION_SECRET'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  alfrescoTarget: required('ALFRESCO_TARGET').replace(/\/+$/, ''),
  alfrescoDiagnostics: process.env.ALFRESCO_DIAGNOSTICS === 'true',
  basicAuthEnabled: process.env.ALFRESCO_BASIC_AUTH_ENABLED !== 'false',
  ssoAuthMode: process.env.ALFRESCO_SSO_AUTH_MODE || 'bearer',
  groupMappings,
  userInboxNodeIds: parseJson('ALFRESCO_USER_INBOX_NODE_IDS_JSON', {}),
  officeInboxNodeIds: parseJson('ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON', {}),
  documentClosure: {
    writesEnabled: process.env.DOCUMENT_CLOSURE_WRITES_ENABLED === 'true',
    environment: process.env.DOCUMENT_CLOSURE_ENVIRONMENT || '',
    expectedTarget: process.env.DOCUMENT_CLOSURE_EXPECTED_TARGET || '',
    acknowledgement: process.env.DOCUMENT_CLOSURE_ACKNOWLEDGEMENT || '',
  },
  officeGroupIds: distributionGroupIds(groupMappings, parseJson('ALFRESCO_OFFICE_GROUP_IDS_JSON', undefined)),
  dispatchPersistence: process.env.DISPATCH_PERSISTENCE || 'alfresco',
  dispatchPilot: dispatchPilotSettings(),
  officialEmission: {
    writesEnabled: process.env.OFFICIAL_EMISSION_WRITES_ENABLED === 'true',
    expectedTarget: process.env.OFFICIAL_EMISSION_EXPECTED_TARGET || '',
    acknowledgement: process.env.OFFICIAL_EMISSION_ACK || '',
    leasePath: process.env.OFFICIAL_EMISSION_LEASE_PATH || path.join(backendRoot, 'data', 'official-emission.lock'),
    reconciliationPath: process.env.OFFICIAL_EMISSION_RECONCILIATION_FILE || '',
    reconciliationSha256: process.env.OFFICIAL_EMISSION_RECONCILIATION_SHA256 || '',
  },
  hierarchyReadStorage: process.env.HIERARCHY_READ_STORAGE || 'alfresco',
    hierarchyPilot: {
      expectedContainers: [process.env.ALFRESCO_HIERARCHY_PILOT_EXPECTED_CONTAINER, process.env.ALFRESCO_HIERARCHY_PILOT_EXPECTED_AUDIT, process.env.ALFRESCO_HIERARCHY_PILOT_EXPECTED_LAB],
      enabled: process.env.ALFRESCO_HIERARCHY_DSA_PILOT_ENABLED === 'true',
      dependency: process.env.ALFRESCO_HIERARCHY_PILOT_DEPENDENCY || '',
      expectedTarget: process.env.ALFRESCO_HIERARCHY_PILOT_EXPECTED_TARGET || '',
      acknowledgement: process.env.ALFRESCO_HIERARCHY_PILOT_ACKNOWLEDGEMENT || '',
      externalWritersDisabled: process.env.ALFRESCO_HIERARCHY_PILOT_NO_EXTERNAL_WRITERS_CONFIRMED === 'true',
      leasePath: process.env.ALFRESCO_HIERARCHY_PILOT_LEASE_PATH || path.join(backendRoot, 'data', 'hierarchy-pilot.lock'),
    },
  responseTimes: {
    storage: process.env.ALFRESCO_RESPONSE_TIMES_STORAGE || '',
    username: process.env.ALFRESCO_RESPONSE_TIMES_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_RESPONSE_TIMES_SERVICE_PASSWORD || '',
    containerNodeId: process.env.ALFRESCO_RESPONSE_TIMES_CONTAINER_NODE_ID || '',
    writesEnabled: process.env.ALFRESCO_RESPONSE_TIMES_WRITES_ENABLED === 'true',
    singleInstancePilotEnabled: process.env.ALFRESCO_RESPONSE_TIMES_SINGLE_INSTANCE_PILOT_ENABLED === 'true',
    pilotExpectedTarget: process.env.ALFRESCO_RESPONSE_TIMES_PILOT_EXPECTED_TARGET || '',
    pilotAcknowledgement: process.env.ALFRESCO_RESPONSE_TIMES_PILOT_ACKNOWLEDGEMENT || '',
    externalWritersDisabled: process.env.ALFRESCO_RESPONSE_TIMES_PILOT_NO_EXTERNAL_WRITERS_CONFIRMED === 'true',
    pilotLeasePath: process.env.ALFRESCO_RESPONSE_TIMES_PILOT_LEASE_PATH || path.join(backendRoot, 'data', 'response-times-pilot.lock'),
  },
  distributionService: {
    username: process.env.ALFRESCO_DISTRIBUTION_SERVICE_USERNAME || process.env.ALFRESCO_DISTRIBUTION_USERNAME || '',
    password: process.env.ALFRESCO_DISTRIBUTION_SERVICE_USERNAME
      ? process.env.ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD || ''
      : process.env.ALFRESCO_DISTRIBUTION_PASSWORD || '',
  },
  hierarchyService: {
    username: process.env.ALFRESCO_HIERARCHY_SERVICE_USERNAME || '',
    password: process.env.ALFRESCO_HIERARCHY_SERVICE_PASSWORD || '',
    containerNodeId: process.env.ALFRESCO_HIERARCHY_CONTAINER_NODE_ID || '',
    auditContainerNodeId: process.env.ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID || '',
    labContainerNodeId: process.env.ALFRESCO_HIERARCHY_LAB_CONTAINER_NODE_ID || '',
    storage: process.env.ALFRESCO_HIERARCHY_STORAGE || '',
    unitWritesEnabled: process.env.ALFRESCO_HIERARCHY_UNIT_WRITES_ENABLED === 'true',
    unitEditsEnabled: process.env.ALFRESCO_HIERARCHY_UNIT_EDITS_ENABLED === 'true',
    headWritesEnabled: process.env.ALFRESCO_HIERARCHY_HEAD_WRITES_ENABLED === 'true',
    specialistWritesEnabled: process.env.ALFRESCO_HIERARCHY_SPECIALIST_WRITES_ENABLED === 'true',
    headChangesEnabled: process.env.ALFRESCO_HIERARCHY_HEAD_CHANGES_ENABLED === 'true',
    specialistReassignmentsEnabled: process.env.ALFRESCO_HIERARCHY_SPECIALIST_REASSIGNMENTS_ENABLED === 'true',
  },
  technicalUserIds,
  documentIssuerAssignments: parseJson('ALFRESCO_DOCUMENT_ISSUER_ASSIGNMENTS_JSON', {}),
  keycloak: {
    issuer: required('KEYCLOAK_ISSUER'),
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || undefined,
    redirectUri: required('KEYCLOAK_REDIRECT_URI'),
  },
}
