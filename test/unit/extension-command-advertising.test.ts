import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { FakeAgentSideConnection, asAgentConn } from '../helpers/fakes.js'

class FakeSessions {
  constructor(private readonly session: any) {}

  async create() {
    return this.session
  }

  closeAllExcept() {}
}

test('PiAcpAgent: advertises Pi extension commands and caches their metadata', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-acp-extension-commands-'))
  mkdirSync(join(cwd, '.pi'), { recursive: true })
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ quietStartup: true }), 'utf8')

  const conn = new FakeAgentSideConnection()
  const scheduled: Array<() => void> = []
  const originalSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = (fn: () => void) => {
    scheduled.push(fn)
    return 0 as any
  }

  let cachedCommands: unknown[] = []
  const session = {
    sessionId: 's1',
    cwd,
    proc: {
      async getState() {
        return { thinkingLevel: 'medium', model: { provider: 'test', id: 'model' } }
      },
      async getAvailableModels() {
        return { models: [{ provider: 'test', id: 'model', name: 'Model' }] }
      },
      async getCommands() {
        return {
          commands: [
            { name: 'inspect', description: 'Inspect the current agent', source: 'extension' },
            { name: 'prompt-one', description: 'Prompt', source: 'prompt', location: 'project' }
          ]
        }
      }
    },
    setStartupInfo() {},
    sendStartupInfoIfPending() {},
    setPiCommands(commands: unknown[]) {
      cachedCommands = commands
    }
  }

  try {
    const agent = new PiAcpAgent(asAgentConn(conn))
    ;(agent as any).sessions = new FakeSessions(session) as any

    await agent.newSession({ cwd, mcpServers: [] } as any)
  } finally {
    ;(globalThis as any).setTimeout = originalSetTimeout
  }

  for (const callback of scheduled) callback()
  await new Promise(resolve => setTimeout(resolve, 0))

  const update = conn.updates.find(item => item.update.sessionUpdate === 'available_commands_update')
  assert.ok(update)
  assert.deepEqual((update.update as any).availableCommands.slice(0, 2), [
    { name: 'inspect', description: 'Inspect the current agent' },
    { name: 'prompt-one', description: 'Prompt' }
  ])
  assert.deepEqual(cachedCommands, [
    { name: 'inspect', description: 'Inspect the current agent', source: 'extension' },
    { name: 'prompt-one', description: 'Prompt', source: 'prompt', location: 'project' }
  ])
})
