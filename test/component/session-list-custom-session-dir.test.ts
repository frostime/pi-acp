import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listPiSessions } from '../../src/acp/pi-sessions.js'

test('listPiSessions: respects sessionDir from pi settings.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-test-'))
  const customSessionsDir = join(root, 'somewhere-else', '--p--')
  mkdirSync(customSessionsDir, { recursive: true })

  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({ sessionDir: join(root, 'somewhere-else') }, null, 2),
    'utf8'
  )

  writeFileSync(
    join(customSessionsDir, 's.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'sess-custom',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/tmp/project'
      }),
      JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'hi' }
      })
    ].join('\n') + '\n',
    { encoding: 'utf8' }
  )

  const oldEnv = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = root

  try {
    const s = listPiSessions().find(x => x.sessionId === 'sess-custom')
    assert.ok(s)
    assert.equal(s?.sessionFile, join(customSessionsDir, 's.jsonl'))
  } finally {
    if (oldEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = oldEnv
  }
})

test('listPiSessions: project sessionDir overrides global settings and filters the custom directory by cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-test-'))
  const project = join(root, 'project')
  const globalSessionsDir = join(root, 'global-sessions')
  const projectSessionsDir = join(project, '.pi', 'project-sessions')
  mkdirSync(globalSessionsDir, { recursive: true })
  mkdirSync(projectSessionsDir, { recursive: true })

  writeFileSync(join(root, 'settings.json'), JSON.stringify({ sessionDir: 'global-sessions' }), 'utf8')
  writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ sessionDir: 'project-sessions' }), 'utf8')

  const writeSession = (dir: string, id: string, cwd: string) => {
    writeFileSync(
      join(dir, `${id}.jsonl`),
      JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-01-01T00:00:00.000Z', cwd }) + '\n',
      'utf8'
    )
  }

  writeSession(globalSessionsDir, 'global-session', project)
  writeSession(projectSessionsDir, 'project-session', project)
  writeSession(projectSessionsDir, 'other-session', join(root, 'other-project'))

  const oldAgentDir = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = root

  try {
    assert.deepEqual(
      listPiSessions(project).map(session => session.sessionId),
      ['project-session']
    )
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir
  }
})

test('listPiSessions: PI_CODING_AGENT_SESSION_DIR overrides project and global sessionDir settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-test-'))
  const project = join(root, 'project')
  const envSessionsDir = join(root, 'env-sessions')
  mkdirSync(envSessionsDir, { recursive: true })
  mkdirSync(join(project, '.pi'), { recursive: true })

  writeFileSync(join(root, 'settings.json'), JSON.stringify({ sessionDir: 'global-sessions' }), 'utf8')
  writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ sessionDir: 'project-sessions' }), 'utf8')
  writeFileSync(
    join(envSessionsDir, 'env-session.jsonl'),
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'env-session',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: project
    }) + '\n',
    'utf8'
  )

  const oldAgentDir = process.env.PI_CODING_AGENT_DIR
  const oldSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR
  process.env.PI_CODING_AGENT_DIR = root
  process.env.PI_CODING_AGENT_SESSION_DIR = envSessionsDir

  try {
    assert.deepEqual(
      listPiSessions(project).map(session => session.sessionId),
      ['env-session']
    )
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir
    if (oldSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = oldSessionDir
  }
})
