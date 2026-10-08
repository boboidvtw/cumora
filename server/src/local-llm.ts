/**
 * Self-host switch: run the server's own LLM calls on a model on this machine.
 *
 * The server makes small "cerebellum" calls of its own — the BYOA agenda
 * check (should an idle agent pick up a board card or a stalled thread?),
 * inbox triage, message routing, Convene decisions, palettes. Upstream sends
 * them to OpenAI with OPENAI_API_KEY. A self-hosted deployment without that
 * key had every one of them fail with a 401, so BYOA agents never picked up
 * board work on their own.
 *
 * With SERVER_LLM=local and LOCAL_LLM_BASE_URL set (LM Studio, which speaks
 * the Responses API), the legacy client in llm.ts points there instead, and
 * every `responses.create` is rewritten to:
 *   - use LOCAL_LLM_MODEL, since callers name OpenAI models;
 *   - turn reasoning off. Callers ask for 'minimal' / 'low', which a local
 *     reasoning model (Qwen) still spends ~250 tokens on: ~16s a call on this
 *     Mac against ~4s with effort 'none', and the daemon gives /agenda 20s.
 * Embeddings and images are not routed (LM Studio has no matching models).
 */
import type OpenAI from 'openai'

export interface LocalLlmConfig { baseURL: string; model: string }

/** What LM Studio answers to when no model is named: the loaded one. */
const ANY_LOADED_MODEL = 'local-model'

export function localLlmConfig(e: {
  SERVER_LLM: string
  LOCAL_LLM_BASE_URL: string
  LOCAL_LLM_MODEL: string
}): LocalLlmConfig | null {
  if (e.SERVER_LLM !== 'local' || !e.LOCAL_LLM_BASE_URL) return null
  return { baseURL: e.LOCAL_LLM_BASE_URL, model: e.LOCAL_LLM_MODEL || ANY_LOADED_MODEL }
}

type ResponsesArgs = { model?: string; reasoning?: Record<string, unknown> } & Record<string, unknown>

/** A copy of one `responses.create` call's args, fitted to the local model. */
export function localResponsesArgs<T extends ResponsesArgs>(args: T, model: string): T {
  return { ...args, model, reasoning: { ...args.reasoning, effort: 'none' } }
}

/** Wrap a client pointed at the local server so every `responses.create`
 *  goes through {@link localResponsesArgs}. Everything else passes through. */
export function withLocalModel(client: OpenAI, model: string): OpenAI {
  return new Proxy(client, {
    get(target, prop, receiver): unknown {
      if (prop !== 'responses') return Reflect.get(target, prop, receiver)
      const real = target.responses
      return new Proxy(real, {
        get(rt, p, rr): unknown {
          if (p !== 'create') return Reflect.get(rt, p, rr)
          return (args: ResponsesArgs, opts?: unknown) =>
            (real.create as (a: unknown, o?: unknown) => unknown).call(real, localResponsesArgs(args, model), opts)
        },
      })
    },
  })
}
