import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PiAcpAgent } from '../../src/acp/agent.js'
import { getPiSessionsDir } from '../../src/acp/pi-sessions.js'
import { FakeAgentSideConnection, asAgentConn } from '../helpers/fakes.js'

test('PiAcpAgent: listSessions defaults to lastSessionCwd when cwd param is omitted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-test-'))
  const oldEnv = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = root

  const dirA = getPiSessionsDir('/cwd/a')
  const dirB = getPiSessionsDir('/cwd/b')
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })

  writeFileSync(
    join(dirA, '1.jsonl'),
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'sess-a',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/cwd/a'
    }) +
      '\n' +
      JSON.stringify({
        type: 'session_info',
        id: 'a1b2c3d4',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        name: 'A'
      }) +
      '\n',
    { encoding: 'utf8' }
  )

  writeFileSync(
    join(dirB, '2.jsonl'),
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'sess-b',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/cwd/b'
    }) +
      '\n' +
      JSON.stringify({
        type: 'session_info',
        id: 'b1b2c3d4',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        name: 'B'
      }) +
      '\n',
    { encoding: 'utf8' }
  )

  try {
    const conn = new FakeAgentSideConnection()
    const agent = new PiAcpAgent(asAgentConn(conn))

    ;(agent as any).lastSessionCwd = '/cwd/a'

    const listed = await agent.listSessions({} as any)
    assert.equal(listed.sessions.length, 1)
    assert.equal(listed.sessions[0]?.sessionId, 'sess-a')
  } finally {
    if (oldEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = oldEnv
  }
})

test('PiAcpAgent: listSessions keeps pagination stable while Pi history changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-test-'))
  const oldEnv = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = root
  const sessionsDir = getPiSessionsDir('/cwd/project')
  mkdirSync(sessionsDir, { recursive: true })

  const writeSession = (id: string, timestamp: string) => {
    writeFileSync(
      join(sessionsDir, `${id}.jsonl`),
      [
        JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd: '/cwd/project' }),
        JSON.stringify({
          type: 'message',
          id: `${id}-message`,
          parentId: null,
          timestamp,
          message: { role: 'user', content: id }
        })
      ].join('\n') + '\n',
      { encoding: 'utf8' }
    )
  }

  for (let index = 0; index <= 50; index++) {
    writeSession(`sess-${index}`, `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`)
  }

  try {
    const agent = new PiAcpAgent(asAgentConn(new FakeAgentSideConnection()))
    const firstPage = await agent.listSessions({ cwd: '/cwd/project', cursor: null, _meta: null } as any)
    assert.equal(firstPage.sessions.length, 50)
    assert.equal(firstPage.nextCursor, '50')

    writeSession('sess-new', '2026-01-01T00:01:00.000Z')

    const secondPage = await agent.listSessions({ cwd: '/cwd/project', cursor: '50', _meta: null } as any)
    assert.deepEqual(
      secondPage.sessions.map(session => session.sessionId),
      ['sess-0']
    )
  } finally {
    if (oldEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = oldEnv
  }
})
