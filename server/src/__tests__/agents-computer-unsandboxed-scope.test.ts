/**
 * CUMORA_BYOA_ALLOW_UNSANDBOXED takes a list of engines in this fork
 * ("hermes,antigravity"), so "is ANY engine opted out" and "is THIS engine
 * opted out" are different questions. A bare allowUnsandboxedByoa() asks the
 * first; used for a per-agent decision it let a Hermes opt-in lift Claude's
 * and Codex's sandbox (PATH with the model-writable bin first, the shim in
 * that bin, the CLI action surface, whole-argv overrides). Every call must
 * name its engine; the few that really mean "any" carry an `any opt-in:`
 * comment on the line above.
 *
 * Run: node --import tsx --test server/src/__tests__/agents-computer-unsandboxed-scope.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FILES = ['../agents/computer/daemon.ts', '../agents/computer/engine.ts']

test('every unsandboxed check names its engine, unless marked as any-opt-in', () => {
  const hits: string[] = []
  for (const rel of FILES) {
    const lines = readFileSync(new URL(rel, import.meta.url), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!/allowUnsandboxedByoa\(\)/.test(line)) return
      if (/any opt-in:/.test(lines[i - 1] ?? '')) return
      hits.push(`${rel.replace('../', '')}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(hits, [])
})

test('a Hermes-only opt-in leaves Claude and Codex argv overrides off', async () => {
  process.env.CUMORA_RUNTIME_CLIENT ??= 'http'
  process.env.OPENAI_API_KEY ??= 'test-key'
  const { unsafeEngineArgs } = await import('../agents/computer/engine.js')
  const env = { CUMORA_BYOA_ALLOW_UNSANDBOXED: 'hermes', CUMORA_CODEX_ARGS: '--x', CUMORA_CLAUDE_ARGS: '--y' }
  assert.deepEqual(unsafeEngineArgs('CUMORA_CODEX_ARGS', 'codex', env), [])
  assert.deepEqual(unsafeEngineArgs('CUMORA_CLAUDE_ARGS', 'claude', env), [])
  assert.deepEqual(unsafeEngineArgs('CUMORA_CODEX_ARGS', 'codex', { ...env, CUMORA_BYOA_ALLOW_UNSANDBOXED: 'codex' }), ['--x'])
})
