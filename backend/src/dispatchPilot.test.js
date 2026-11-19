import test from 'node:test'
import assert from 'node:assert/strict'
import { pilotAcknowledgements, validatePilotEnvironment } from './dispatchPilot.js'
import { dispatchPilotSettings } from './config.js'

const devTarget = 'https://dev.invalid'
const preprodTarget = 'https://preprod.invalid'
function settings() {
  return { alfrescoTarget: devTarget, officeInboxNodeIds: { DSA: { porAtender: 'existing-dsa-folder' } },
    dispatchPilot: { writesEnabled: true, environment: 'dev', environments: {
      dev: { enabled: true, acknowledgement: pilotAcknowledgements.dev, expectedTarget: devTarget },
      preprod: { enabled: false, acknowledgement: '', expectedTarget: '' },
    } } }
}

test('configuration defaults to disabled writes; obsolete UUID and test-folder environment variables are never read', () => {
  const pilot = dispatchPilotSettings({ DISPATCH_PILOT_TEST_FOLDER_IDS_JSON: 'invalid JSON ignored', DISPATCH_PILOT_DOCUMENT_IDS_JSON: 'invalid JSON ignored' })
  assert.equal(pilot.writesEnabled, false)
  assert.equal(pilot.environment, '')
  assert.equal(pilot.environments.preprod.enabled, false)
  assert.equal(pilot.testFolderIds, undefined)
  assert.equal(pilot.documentIds, undefined)
  const fromEnvironment = dispatchPilotSettings({
    DISPATCH_ALFRESCO_WRITES_ENABLED: 'true', DISPATCH_PILOT_ENVIRONMENT: 'dev',
    DISPATCH_PILOT_ACK: pilotAcknowledgements.dev, DISPATCH_PILOT_ALFRESCO_TARGET: devTarget,
  })
  assert.equal(validatePilotEnvironment({ ...settings(), dispatchPilot: fromEnvironment }).environment, 'dev')
  assert.equal(fromEnvironment.environments.preprod.enabled, false)
})

test('DEV requires enabled writes, explicit institutional acknowledgement, selected environment and exact destination', () => {
  const config = settings()
  assert.deepEqual(validatePilotEnvironment(config), { environment: 'dev', alfrescoTarget: devTarget,
    institutionalFolders: { DSA: ['existing-dsa-folder'] } })
  for (const modify of [
    (value) => { value.dispatchPilot.writesEnabled = false },
    (value) => { value.dispatchPilot.environment = '' },
    (value) => { value.dispatchPilot.environment = 'production' },
    (value) => { value.dispatchPilot.environments.dev.acknowledgement = '' },
    (value) => { value.dispatchPilot.environments.dev.acknowledgement = 'single-instance-exclusive-writer-dev-test-documents' },
    (value) => { value.alfrescoTarget = preprodTarget },
  ]) {
    const invalid = settings()
    modify(invalid)
    assert.throws(() => validatePilotEnvironment(invalid), /DISPATCH_ALFRESCO_WRITES_DISABLED|DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
  }
})

test('preproduction has independent enable, acknowledgement and destination; DEV settings never authorize it', () => {
  const config = settings()
  config.dispatchPilot.environment = 'preprod'
  config.alfrescoTarget = preprodTarget
  assert.throws(() => validatePilotEnvironment(config), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
  const profile = config.dispatchPilot.environments.preprod
  profile.expectedTarget = preprodTarget
  profile.acknowledgement = pilotAcknowledgements.preprod
  assert.throws(() => validatePilotEnvironment(config), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
  profile.enabled = true
  assert.equal(validatePilotEnvironment(config).environment, 'preprod')
  profile.acknowledgement = pilotAcknowledgements.dev
  assert.throws(() => validatePilotEnvironment(config), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
  profile.acknowledgement = pilotAcknowledgements.preprod
  config.alfrescoTarget = devTarget
  profile.expectedTarget = devTarget
  assert.throws(() => validatePilotEnvironment(config), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
  config.alfrescoTarget = 'https://DEV.invalid:443'
  profile.expectedTarget = config.alfrescoTarget
  assert.throws(() => validatePilotEnvironment(config), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/, 'case/default port cannot disguise the DEV repository as preproduction')
})

test('institutional folders are mandatory, but no test folder or document UUID registry is needed', () => {
  const config = settings()
  assert.ok(validatePilotEnvironment(config))
  config.dispatchPilot.testFolderIds = 'obsolete and deliberately invalid'
  config.dispatchPilot.documentIds = 'obsolete and deliberately invalid'
  assert.ok(validatePilotEnvironment(config), 'obsolete fields are not dependencies')
  config.officeInboxNodeIds = {}
  assert.throws(() => validatePilotEnvironment(config), /DISPATCH_INSTITUTIONAL_SCOPE_REQUIRED/)
})

test('insecure URLs and accidental target changes are rejected before any lease or PUT', () => {
  for (const target of ['http://dev.invalid', 'https://user:secret@dev.invalid', 'https://dev.invalid/?credential=secret', 'https://dev.invalid/other', 'invalid']) {
    const config = settings()
    config.alfrescoTarget = target
    config.dispatchPilot.environments.dev.expectedTarget = target
    assert.throws(() => validatePilotEnvironment(config), /DISPATCH_PILOT_ENVIRONMENT_REQUIRED/)
  }
})
