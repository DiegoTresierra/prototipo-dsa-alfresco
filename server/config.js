import dotenv from 'dotenv'

dotenv.config({ path: ['.env.local', '.env'] })

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

export const config = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: required('SESSION_SECRET'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  alfrescoTarget: required('ALFRESCO_TARGET').replace(/\/+$/, ''),
  alfrescoDiagnostics: process.env.ALFRESCO_DIAGNOSTICS === 'true',
  basicAuthEnabled: process.env.ALFRESCO_BASIC_AUTH_ENABLED !== 'false',
  ssoAuthMode: process.env.ALFRESCO_SSO_AUTH_MODE || 'bearer',
  groupMappings: parseJson('ALFRESCO_GROUP_MAPPINGS_JSON', {
    dependencies: { DTI: 'GROUP_GD_DTI', DSA: 'GROUP_GD_DSA' },
    functions: {
      direccion: 'GROUP_GD_DIRECCION',
      'jefe-unidad': 'GROUP_GD_JEFE_UNIDAD',
      especialista: 'GROUP_GD_ESPECIALISTA',
    },
  }),
  keycloak: {
    issuer: required('KEYCLOAK_ISSUER'),
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || undefined,
    redirectUri: required('KEYCLOAK_REDIRECT_URI'),
  },
}
