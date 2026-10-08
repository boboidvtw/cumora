/**
 * When an engine has used up its plan it usually says when it comes back:
 *
 *   Codex   "You've hit your usage limit. … or try again at 11:58 PM."
 *           "… try again at Oct 10th, 2026 3:15 PM."
 *   Claude  "5-hour limit reached ∙ resets 11pm"
 *           "Claude AI usage limit reached|1759999999"
 *   others  "try again in 2 hours 5 minutes"
 *
 * Clock times are the engine's local time, which is this machine's: the CLI
 * runs here. A time-of-day that has already passed means tomorrow. Anything
 * unreadable gives null, and the caller keeps its normal short cooldown.
 */

/** Longest pause a parsed reset may impose (Codex has weekly limits). */
export const MAX_LIMIT_WAIT_MS = 8 * 24 * 3_600_000

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }

const EPOCH_RE = /usage limit reached\|(\d{9,11})\b/i
const DURATION_RE = /try again in ((?:\d+\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)[\s,]*(?:and\s+)?)+)/i
const AT_RE = /(?:try again at|resets(?: at)?)\s+([^.()\n]*(?:[ap]\.?m\.?))/i
const CLOCK_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i
const DATE_RE = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/

export function limitResetAt(errorText: string, now: Date): number | null {
  const reset = epochReset(errorText) ?? durationReset(errorText, now) ?? clockReset(errorText, now)
  if (reset === null || reset <= now.getTime()) return null
  return Math.min(reset, now.getTime() + MAX_LIMIT_WAIT_MS)
}

function epochReset(text: string): number | null {
  const m = text.match(EPOCH_RE)
  return m ? Number(m[1]) * 1000 : null
}

function durationReset(text: string, now: Date): number | null {
  const m = text.match(DURATION_RE)
  if (!m) return null
  let total = 0
  for (const part of m[1].matchAll(/(\d+)\s*([a-z])/gi)) {
    total += Number(part[1]) * (UNIT_MS[part[2].toLowerCase()] ?? 0)
  }
  return total > 0 ? now.getTime() + total : null
}

function clockReset(text: string, now: Date): number | null {
  const phrase = text.match(AT_RE)?.[1]?.trim()
  const clock = phrase?.match(CLOCK_RE)
  if (!phrase || !clock) return null
  const hour12 = Number(clock[1])
  const minute = clock[2] === undefined ? 0 : Number(clock[2])
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null
  const hour = (hour12 % 12) + (clock[3].toLowerCase() === 'p' ? 12 : 0)

  const date = phrase.match(DATE_RE)
  if (date) {
    const month = MONTHS.indexOf(date[1].slice(0, 3).toLowerCase())
    if (month < 0) return null
    return new Date(Number(date[3]), month, Number(date[2]), hour, minute).getTime()
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
  if (today.getTime() <= now.getTime()) today.setDate(today.getDate() + 1)
  return today.getTime()
}
