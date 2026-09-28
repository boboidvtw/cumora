import type { MessageKey } from '@/lib/i18n'

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

/** The hint lines `authFailureHint` (server/src/agents/computer/daemon.ts)
 *  appends to a byoa_engine_failed notice. The daemon runs on the user's
 *  computer — often the npm `cumora` package, which this bundle can't change —
 *  so its English is matched here rather than changed there. A hint that
 *  isn't listed (or one upstream rewords) is shown as sent. */
const HINTS: Record<string, MessageKey> = {
  'The agent filled up its context window. Its session has been reset automatically — just wake the agent again and it will start fresh.': 'notice.hintContextOverflow',
  'A malformed character (a split emoji) had poisoned the agent\'s session. It has been reset automatically — just wake the agent again.': 'notice.hintPoisonedBody',
  'Check the daemon terminal for details, then wake the agent again.': 'notice.hintCheckDaemon',
  'Open Claude Code on that computer and sign in, refresh quota, or add credits, then wake the agent again.': 'notice.hintClaude',
  'Open Codex on that computer and refresh its login or quota, then wake the agent again.': 'notice.hintCodex',
  'Hermes runs in a container against the model in its config.yaml: check that the model server (LM Studio by default) is up and the model is loaded, then wake the agent again.': 'notice.hintHermes',
}

/** `${agent.name} could not run on local ${engine}: ${error}\n${hint}` */
const ENGINE_FAILED = /^(.+?) could not run on local ([\w-]+): ([\s\S]*)$/

/** Render a system notice in the viewer's language where its shape is known.
 *  Notices arrive as finished English sentences, so only the sentence frame
 *  and the fixed hints are translated; the engine's own error output stays
 *  verbatim. Anything unrecognised is returned unchanged. */
export function localizeNotice(noticeKind: string | undefined, text: string, t: T): string {
  if (noticeKind !== 'byoa_engine_failed') return text
  const m = ENGINE_FAILED.exec(text)
  if (!m) return text
  const [, name, engine, rest] = m
  const cut = rest.lastIndexOf('\n')
  const error = cut >= 0 ? rest.slice(0, cut) : rest
  const hint = cut >= 0 ? rest.slice(cut + 1) : ''
  const hintKey = HINTS[hint.trim()]
  const line = t('notice.byoaEngineFailed', { name, engine, error })
  if (!hint) return line
  return `${line}\n${hintKey ? t(hintKey) : hint}`
}
