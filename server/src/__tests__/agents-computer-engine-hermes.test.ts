/**
 * Contract tests for ACP agent→client requests and the BYOA Hermes adapter.
 *
 * An ACP engine asks `session/request_permission` before a tool call and waits
 * for the answer. Cumora used to ignore every agent→client request, so such a
 * turn stalled until the engine's own timeout. The fake agent below asks for
 * permission in the middle of a prompt and only finishes the turn once it is
 * answered, so a regression shows up as a test timeout rather than a pass.
 *
 * Hermes is reached through CUMORA_HERMES_ACP_BIN, the same override operators
 * use to point the daemon at the container wrapper; ZCode through
 * CUMORA_ZCODE_ACP_BIN. Same fake, two policies.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { answerAcpClientRequest, detectEnginesWithStatus, getAdapter, snapshotDetectedEngines } from '../agents/computer/engine.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const OPTIONS = [
  { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'no', name: 'Reject', kind: 'reject_once' },
]

const FAKE_AGENT = `#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const readline = require('node:readline')
const log = process.env.FAKE_ACP_LOG
const mode = process.env.FAKE_ACP_MODE || 'permission'
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
const record = (entry) => { if (log) fs.appendFileSync(log, JSON.stringify(entry) + '\\n') }
let pendingPrompt = null
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  // A reply to our own request (no method): the client's answer.
  if (!msg.method) {
    record({ answer: msg })
    if (pendingPrompt !== null) {
      const text = msg.result && msg.result.outcome && msg.result.outcome.optionId === 'yes' ? 'RAN' : 'SKIPPED'
      out({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } })
      out({ jsonrpc: '2.0', id: pendingPrompt, result: { stopReason: 'end_turn' } })
      pendingPrompt = null
    }
    return
  }
  record({ method: msg.method })
  const reply = (result) => out({ jsonrpc: '2.0', id: msg.id, result })
  if (msg.method === 'initialize') return reply({})
  if (msg.method === 'session/new') return reply({ sessionId: 'sess-1' })
  if (msg.method === 'session/prompt') {
    pendingPrompt = msg.id
    if (mode === 'unknown-method') {
      // A string id, and a method Cumora does not implement.
      return out({ jsonrpc: '2.0', id: 'fs-1', method: 'fs/read_text_file', params: { path: '/etc/passwd' } })
    }
    return out({
      jsonrpc: '2.0', id: 'perm-1', method: 'session/request_permission',
      params: { sessionId: 'sess-1', toolCall: { toolCallId: 't1', title: 'terminal: cumora reply' }, options: ${JSON.stringify(OPTIONS)} },
    })
  }
  return reply({})
})
`

interface Fixture { home: string; log: string; fake: string; logs: string[] }

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'cumora-acp-perm-'))
  tempDirs.push(root)
  const home = join(root, 'home')
  await mkdir(home, { recursive: true })
  const fake = join(root, 'fake-acp-agent.cjs')
  await writeFile(fake, FAKE_AGENT, 'utf8')
  await chmod(fake, 0o755)
  return { home, log: join(root, 'fake.log'), fake, logs: [] }
}

async function answers(f: Fixture): Promise<Array<Record<string, unknown>>> {
  return (await readFile(f.log, 'utf8')).split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as { answer?: Record<string, unknown> })
    .flatMap((e) => (e.answer ? [e.answer] : []))
}

test('answerAcpClientRequest: approve picks allow_once, reject picks reject_once', () => {
  const params = { options: OPTIONS }
  assert.deepEqual(
    answerAcpClientRequest('session/request_permission', params, 'approve'),
    { result: { outcome: { outcome: 'selected', optionId: 'yes' } } },
  )
  assert.deepEqual(
    answerAcpClientRequest('session/request_permission', params, 'reject'),
    { result: { outcome: { outcome: 'selected', optionId: 'no' } } },
  )
})

test('answerAcpClientRequest: falls back to the *_always kind, then to cancelled', () => {
  const alwaysOnly = { options: [{ optionId: 'a', kind: 'allow_always' }, { optionId: 'r', kind: 'reject_always' }] }
  assert.deepEqual(answerAcpClientRequest('session/request_permission', alwaysOnly, 'approve'), { result: { outcome: { outcome: 'selected', optionId: 'a' } } })
  assert.deepEqual(answerAcpClientRequest('session/request_permission', alwaysOnly, 'reject'), { result: { outcome: { outcome: 'selected', optionId: 'r' } } })
  for (const params of [undefined, {}, { options: 'nope' }, { options: [{ kind: 'allow_once' }] }]) {
    assert.deepEqual(answerAcpClientRequest('session/request_permission', params, 'approve'), { result: { outcome: { outcome: 'cancelled' } } })
  }
})

test('answerAcpClientRequest: any other method is "method not found", never silence', () => {
  const reply = answerAcpClientRequest('terminal/create', { command: 'rm' }, 'approve')
  assert.ok('error' in reply)
  assert.equal(reply.error.code, -32601)
})

test('hermes approves a mid-turn permission request and the turn completes', async () => {
  const f = await fixture()
  const r = await getAdapter('hermes').run({
    home: f.home,
    env: { ...process.env, CUMORA_HERMES_ACP_BIN: f.fake, FAKE_ACP_LOG: f.log },
    prompt: 'reply to the room',
    signal: new AbortController().signal,
    onLog: (line) => f.logs.push(line),
  } as Parameters<ReturnType<typeof getAdapter>['run']>[0])
  assert.equal(r.exitCode, 0)
  assert.deepEqual(await answers(f), [{ jsonrpc: '2.0', id: 'perm-1', result: { outcome: { outcome: 'selected', optionId: 'yes' } } }])
  assert.ok(f.logs.some((l) => l.includes('[hermes] session/request_permission for terminal: cumora reply → yes')), f.logs.join('\n'))
})

test('zcode rejects a permission request immediately instead of stalling the turn', async () => {
  const f = await fixture()
  const r = await getAdapter('zcode').classify({
    cwd: f.home,
    env: { ...process.env, CUMORA_ZCODE_ACP_BIN: f.fake, FAKE_ACP_LOG: f.log },
    prompt: 'classify',
    signal: new AbortController().signal,
  } as Parameters<ReturnType<typeof getAdapter>['classify']>[0])
  assert.equal(r.text, 'SKIPPED')
  assert.deepEqual(await answers(f), [{ jsonrpc: '2.0', id: 'perm-1', result: { outcome: { outcome: 'selected', optionId: 'no' } } }])
})

test('an unimplemented agent→client request gets a JSON-RPC error with its string id', async () => {
  const f = await fixture()
  const r = await getAdapter('hermes').classify({
    cwd: f.home,
    env: { ...process.env, CUMORA_HERMES_ACP_BIN: f.fake, FAKE_ACP_LOG: f.log, FAKE_ACP_MODE: 'unknown-method' },
    prompt: 'classify',
    signal: new AbortController().signal,
  } as Parameters<ReturnType<typeof getAdapter>['classify']>[0])
  assert.equal(r.text, 'SKIPPED')
  const [answer] = await answers(f)
  assert.equal(answer.id, 'fs-1')
  assert.equal((answer.error as { code: number }).code, -32601)
})

test('hermes counts as installed only through its container wrapper', async () => {
  const f = await fixture()
  const saved = process.env.CUMORA_HERMES_ACP_BIN
  try {
    process.env.CUMORA_HERMES_ACP_BIN = f.fake
    assert.ok((await detectEnginesWithStatus()).engines.includes('hermes'))
    const [snap] = await snapshotDetectedEngines(['hermes'])
    assert.equal(snap.path, f.fake)
    assert.equal(snap.bin, 'hermes-acp-container', 'never the host `hermes` binary')

    process.env.CUMORA_HERMES_ACP_BIN = join(f.home, 'missing')
    const [missing] = await snapshotDetectedEngines(['hermes'])
    assert.notEqual(missing.path, join(f.home, 'missing'), 'a pin to a nonexistent file is ignored')
  } finally {
    if (saved === undefined) delete process.env.CUMORA_HERMES_ACP_BIN
    else process.env.CUMORA_HERMES_ACP_BIN = saved
  }
})
