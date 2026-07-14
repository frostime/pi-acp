import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentSideConnection, SessionUpdate } from '@agentclientprotocol/sdk'
import { SessionUpdatePump } from '../../src/acp/session-update-pump.js'
import { FakeAgentSideConnection, asAgentConn } from '../helpers/fakes.js'

test('SessionUpdatePump: reduces a large burst to byte-bounded updates without losing text', async () => {
  const conn = new FakeAgentSideConnection()
  const pump = new SessionUpdatePump(asAgentConn(conn), 's1', { flushDelayMs: 60_000 })

  for (let i = 0; i < 10_000; i += 1) pump.appendAgentMessage('x')
  await pump.flush()

  assert.equal(conn.updates.length, 2)
  assert.equal(conn.updates.map(message => (message.update as any).content.text).join(''), 'x'.repeat(10_000))
})

test('SessionUpdatePump: flushes streamed content before a structural update', async () => {
  const conn = new FakeAgentSideConnection()
  const pump = new SessionUpdatePump(asAgentConn(conn), 's1', { flushDelayMs: 60_000 })

  pump.appendAgentMessage('before')
  pump.send({
    sessionUpdate: 'session_info_update',
    title: 'barrier'
  })
  pump.appendAgentMessage('after')
  await pump.flush()

  assert.deepEqual(
    conn.updates.map(message => message.update),
    [
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'before' } },
      { sessionUpdate: 'session_info_update', title: 'barrier' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'after' } }
    ]
  )
})

test('SessionUpdatePump: keeps terminal output from different tools separate', async () => {
  const conn = new FakeAgentSideConnection()
  const pump = new SessionUpdatePump(asAgentConn(conn), 's1', { flushDelayMs: 60_000 })

  pump.appendTerminalOutput('tool-1', 'one')
  pump.appendTerminalOutput('tool-1', ' two')
  pump.appendTerminalOutput('tool-2', 'other')
  await pump.flush()

  assert.deepEqual(
    conn.updates.map(message => message.update),
    [
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'in_progress',
        _meta: { terminal_output: { terminal_id: 'tool-1', data: 'one two' } }
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-2',
        status: 'in_progress',
        _meta: { terminal_output: { terminal_id: 'tool-2', data: 'other' } }
      }
    ]
  )
})

test('SessionUpdatePump: flushes when the buffered byte limit is reached', async () => {
  const conn = new FakeAgentSideConnection()
  const pump = new SessionUpdatePump(asAgentConn(conn), 's1', {
    flushDelayMs: 60_000,
    maxBufferedBytes: 4
  })

  pump.appendAgentThought('abc')
  pump.appendAgentThought('def')
  await pump.flush()

  assert.deepEqual(
    conn.updates.map(message => (message.update as any).content.text),
    ['abc', 'def']
  )
})

test('SessionUpdatePump: sends queued updates through one ordered writer', async () => {
  const delivered: SessionUpdate[] = []
  let activeDeliveries = 0
  let maxActiveDeliveries = 0
  const conn = {
    async sessionUpdate(message: { update: SessionUpdate }) {
      activeDeliveries += 1
      maxActiveDeliveries = Math.max(maxActiveDeliveries, activeDeliveries)
      await new Promise(resolve => setTimeout(resolve, 1))
      delivered.push(message.update)
      activeDeliveries -= 1
    }
  } as AgentSideConnection
  const pump = new SessionUpdatePump(conn, 's1')

  pump.send({ sessionUpdate: 'session_info_update', title: 'first' })
  pump.send({ sessionUpdate: 'session_info_update', title: 'second' })
  await pump.flush()

  assert.equal(maxActiveDeliveries, 1)
  assert.deepEqual(
    delivered.map(update => (update as any).title),
    ['first', 'second']
  )
})

test('SessionUpdatePump: timer flushes a partial chunk', async () => {
  const conn = new FakeAgentSideConnection()
  const pump = new SessionUpdatePump(asAgentConn(conn), 's1', { flushDelayMs: 5 })

  pump.appendAgentMessage('ready')
  await new Promise(resolve => setTimeout(resolve, 25))

  assert.equal((conn.updates[0]?.update as any)?.content?.text, 'ready')
})

test('SessionUpdatePump: disposal abandons buffered content', async () => {
  const conn = new FakeAgentSideConnection()
  const pump = new SessionUpdatePump(asAgentConn(conn), 's1', { flushDelayMs: 5 })

  pump.appendAgentMessage('stale')
  pump.dispose()
  await new Promise(resolve => setTimeout(resolve, 25))

  assert.equal(conn.updates.length, 0)
})
