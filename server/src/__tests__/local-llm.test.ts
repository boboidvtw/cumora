/**
 * Unit tests for the self-host "server LLM on this machine" switch
 * (server/src/local-llm.ts). No network: the client is a stub, so these
 * assert the config gate and the per-call rewrite, not LM Studio itself.
 *
 * Run: node --import tsx --test server/src/__tests__/local-llm.test.ts
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type OpenAI from 'openai'
import { effectiveCostUsd, priceFor } from '../agents/cost.js'
import { localLlmConfig, localResponsesArgs, withLocalModel } from '../local-llm.js'

const BASE = 'http://host.docker.internal:1234/v1'

test('localLlmConfig: on only when SERVER_LLM=local and a base URL is set', () => {
  assert.deepEqual(
    localLlmConfig({ SERVER_LLM: 'local', LOCAL_LLM_BASE_URL: BASE, LOCAL_LLM_MODEL: 'qwen3.8-27b' }),
    { baseURL: BASE, model: 'qwen3.8-27b' },
  )
  assert.equal(localLlmConfig({ SERVER_LLM: 'openai', LOCAL_LLM_BASE_URL: BASE, LOCAL_LLM_MODEL: 'qwen3.8-27b' }), null)
  assert.equal(localLlmConfig({ SERVER_LLM: 'local', LOCAL_LLM_BASE_URL: '', LOCAL_LLM_MODEL: 'qwen3.8-27b' }), null)
})

test('localLlmConfig: an unset model falls back to whatever LM Studio has loaded', () => {
  assert.deepEqual(
    localLlmConfig({ SERVER_LLM: 'local', LOCAL_LLM_BASE_URL: BASE, LOCAL_LLM_MODEL: '' }),
    { baseURL: BASE, model: 'local-model' },
  )
})

test('localResponsesArgs: swaps the model and turns reasoning off, keeps the rest', () => {
  const args = {
    model: 'gpt-5.4-mini',
    instructions: 'Reply as JSON.',
    input: 'agenda',
    text: { format: { type: 'json_object' } },
    max_output_tokens: 2000,
    reasoning: { effort: 'minimal' },
  }
  const out = localResponsesArgs(args, 'qwen3.8-27b')
  assert.equal(out.model, 'qwen3.8-27b')
  assert.deepEqual(out.reasoning, { effort: 'none' })
  assert.deepEqual(out.text, args.text)
  assert.equal(out.max_output_tokens, 2000)
  // The caller's object is left alone.
  assert.equal(args.model, 'gpt-5.4-mini')
  assert.deepEqual(args.reasoning, { effort: 'minimal' })
})

test('localResponsesArgs: adds reasoning off even when the caller set none', () => {
  const bare: { model: string; input: string; reasoning?: Record<string, unknown> } = { model: 'x', input: 'hi' }
  assert.deepEqual(localResponsesArgs(bare, 'm').reasoning, { effort: 'none' })
})

test('withLocalModel: responses.create gets the rewritten args, other members pass through', async () => {
  let captured: Record<string, unknown> = {}
  const embeddings = { create: () => 'untouched' }
  const fake = {
    responses: { create: async (a: Record<string, unknown>) => { captured = a; return { output_text: '{}' } } },
    embeddings,
  } as unknown as OpenAI
  const client = withLocalModel(fake, 'qwen3.8-27b')
  const r = await client.responses.create({ model: 'gpt-5.4-mini', input: 'hi', reasoning: { effort: 'low' } } as never)
  assert.deepEqual(r, { output_text: '{}' })
  assert.equal(captured.model, 'qwen3.8-27b')
  assert.deepEqual(captured.reasoning, { effort: 'none' })
  assert.equal(client.embeddings, embeddings)
})

test('priceFor: the local model is free only while SERVER_LLM=local', () => {
  const saved = { SERVER_LLM: process.env.SERVER_LLM, LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL }
  try {
    process.env.LOCAL_LLM_MODEL = 'qwen3.8-27b'
    process.env.SERVER_LLM = 'local'
    assert.deepEqual(effectiveCostUsd('qwen3.8-27b', { inputTokens: 1000, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 1000 }), { usd: 0, estimated: false })
    // Other models keep their seeded rate.
    assert.equal(priceFor('gpt-5.4-mini').outPer1M, 2)
    process.env.SERVER_LLM = 'openai'
    assert.notEqual(priceFor('qwen3.8-27b').outPer1M, 0)
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})
