import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

class FakeSessions {
  constructor(private readonly session: any) {}
  maybeGet(_id: string) {
    return this.session
  }
  get(_id: string) {
    return this.session
  }
}

test('PiAcpAgent: /steering is handled adapter-side', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  proc.getState = async () => ({ steeringMode: 'one-at-a-time' })

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions({ sessionId: 's1', proc, fileCommands: [] }) as any

  const res = await agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: '/steering' }]
  } as any)

  assert.equal(res.stopReason, 'end_turn')
  assert.equal(proc.prompts.length, 0)
  const last = conn.updates.at(-1)
  assert.match((last as any).update.content.text, /Steering mode: one-at-a-time/)
})

test('PiAcpAgent: /name sets session display name adapter-side', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any

  let setTo: string | null = null
  proc.setSessionName = async (name: string) => {
    setTo = name
  }

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions({ sessionId: 's1', proc, fileCommands: [] }) as any

  const res = await agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: '/name My Session' }]
  } as any)

  assert.equal(res.stopReason, 'end_turn')
  assert.equal(proc.prompts.length, 0)
  assert.equal(setTo, 'My Session')
  const info = conn.updates.find(u => (u as any).update?.sessionUpdate === 'session_info_update')
  assert.equal((info as any)?.update?.title, 'My Session')

  const last = conn.updates.at(-1)
  assert.match((last as any).update.content.text, /Session name set: My Session/)
})

test('PiAcpAgent: Pi extension command takes priority over same-name adapter built-in', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  let forwarded: string | null = null
  let setNameCalled = false

  proc.setSessionName = async () => {
    setNameCalled = true
  }

  const session = {
    sessionId: 's1',
    proc,
    ensurePiCommandsLoaded: async () => {},
    isExtensionCommand: (message: string) => message.startsWith('/name'),
    prompt: async (message: string) => {
      forwarded = message
      return 'end_turn'
    },
    wasCancelRequested: () => false
  }

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  const res = await agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: '/name extension-value' }]
  } as any)

  assert.equal(res.stopReason, 'end_turn')
  assert.equal(forwarded, '/name extension-value')
  assert.equal(setNameCalled, false)
})

test('PiAcpAgent: cancel during command discovery prevents an adapter built-in from running', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  let setNameCalled = false
  let cancelEpoch = 0
  let releaseCommands: (() => void) | undefined

  proc.setSessionName = async () => {
    setNameCalled = true
  }

  const session = {
    sessionId: 's1',
    proc,
    getCancelEpoch: () => cancelEpoch,
    wasCancelledSince: (epoch: number) => cancelEpoch !== epoch,
    ensurePiCommandsLoaded: async () =>
      new Promise<void>(resolve => {
        releaseCommands = resolve
      }),
    isExtensionCommand: () => false,
    cancel: async () => {
      cancelEpoch += 1
    },
    prompt: async () => 'end_turn',
    wasCancelRequested: () => true
  }

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  const prompt = agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: '/name Should Not Run' }]
  } as any)

  await new Promise(resolve => setTimeout(resolve, 0))
  await agent.cancel({ sessionId: 's1' } as any)

  assert.ok(releaseCommands)
  releaseCommands()

  assert.equal((await prompt).stopReason, 'cancelled')
  assert.equal(setNameCalled, false)
})
