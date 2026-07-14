import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { parseSessionUpdateMode } from '../../src/acp/session-update-pump.js'
import { FakeAgentSideConnection, asAgentConn } from '../helpers/fakes.js'

test('parseSessionUpdateMode: defaults to coalesced', () => {
  assert.equal(parseSessionUpdateMode(undefined), 'coalesced')
})

test('parseSessionUpdateMode: accepts explicit modes', () => {
  assert.equal(parseSessionUpdateMode('coalesced'), 'coalesced')
  assert.equal(parseSessionUpdateMode('legacy'), 'legacy')
})

test('parseSessionUpdateMode: rejects an invalid mode', () => {
  assert.throws(() => parseSessionUpdateMode('batch'), /PI_ACP_SESSION_UPDATE_MODE must be "coalesced" or "legacy"/)
})

test('PiAcpAgent: rejects an invalid update mode during initialization', () => {
  const previous = process.env.PI_ACP_SESSION_UPDATE_MODE
  process.env.PI_ACP_SESSION_UPDATE_MODE = 'batch'

  try {
    assert.throws(
      () => new PiAcpAgent(asAgentConn(new FakeAgentSideConnection())),
      /PI_ACP_SESSION_UPDATE_MODE must be "coalesced" or "legacy"/
    )
  } finally {
    if (previous === undefined) delete process.env.PI_ACP_SESSION_UPDATE_MODE
    else process.env.PI_ACP_SESSION_UPDATE_MODE = previous
  }
})
