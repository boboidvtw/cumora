/**
 * Server-side script pin for agent output: Simplified → Traditional Chinese
 * (Taiwan wording), applied where an agent's text is written.
 *
 * The persona already asks for Traditional Chinese, but a local model still
 * slips Simplified characters in ("多云" in an otherwise Traditional reply).
 * A prompt can make that rarer; only a conversion at the write boundary makes
 * it never reach the room — and it covers both daemons (the npm `cumora` one
 * ships its own prompt rules this branch cannot change).
 *
 * Off unless AGENT_OUTPUT_SCRIPT=zh-TW, so upstream behaviour is unchanged.
 *
 * Rules, so correct text is never "fixed":
 *   - Only sentences that contain a Simplified character are converted, and
 *     those get OpenCC's cn → twp (characters + Taiwan phrases: 信息→資訊,
 *     软件→軟體). twp also rewrites some valid Traditional phrases (查看→檢視),
 *     so a sentence that is already Traditional is left exactly as written.
 *   - Code (``` fences and `inline`), URLs and email addresses are never
 *     touched: a command, path or link must stay byte-identical.
 */
import * as OpenCC from 'opencc-js'
import { env } from '../env.js'

let toTwChars: ((s: string) => string) | null = null
let toTwPhrases: ((s: string) => string) | null = null
function converters(): { chars: (s: string) => string; phrases: (s: string) => string } {
  // Built lazily: the dictionaries are a few MB and most deployments never
  // turn this on.
  toTwChars ??= OpenCC.Converter({ from: 'cn', to: 'tw' })
  toTwPhrases ??= OpenCC.Converter({ from: 'cn', to: 'twp' })
  return { chars: toTwChars, phrases: toTwPhrases }
}

/** Spans that must survive verbatim. Order matters: fences before inline code. */
const PROTECTED = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`）」』]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi
/** Sentence ends: CJK and ASCII terminators, kept with the sentence. */
const SENTENCE = /[^。！？!?；;\n]*(?:[。！？!?；;]+|\n+|$)/g
const CJK = /[㐀-鿿]/

function convertProse(text: string): string {
  if (!CJK.test(text)) return text
  const { chars, phrases } = converters()
  return text.replace(SENTENCE, (sentence) =>
    sentence && chars(sentence) !== sentence ? phrases(sentence) : sentence,
  )
}

/** Convert Simplified Chinese in `text` to Traditional (Taiwan), leaving code,
 *  URLs and already-Traditional sentences untouched. Pure; ignores the env. */
export function toTraditionalTaiwan(text: string): string {
  if (!CJK.test(text)) return text
  let out = ''
  let last = 0
  for (const m of text.matchAll(PROTECTED)) {
    out += convertProse(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + convertProse(text.slice(last))
}

/** Apply the deployment's output-script pin (AGENT_OUTPUT_SCRIPT) to text an
 *  agent is about to post. Never throws: a converter failure posts the
 *  original text rather than losing the message. */
export function pinAgentOutputScript(text: string): string {
  if (env.AGENT_OUTPUT_SCRIPT !== 'zh-TW' || !text) return text
  try {
    return toTraditionalTaiwan(text)
  } catch (e) {
    console.warn('[zh-script] conversion failed; posting original text', e instanceof Error ? e.message : e)
    return text
  }
}
