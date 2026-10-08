/**
 * An engine that has used up its plan says when it comes back ("try again at
 * 11:58 PM"). Treated as a plain 60s throttle, a Codex agent with an assigned
 * card re-ran its agenda turn every couple of minutes for hours, each one a
 * failed run, until the reset. limitResetAt reads that time so the daemon can
 * wait for it instead.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitResetAt, MAX_LIMIT_WAIT_MS } from '../agents/computer/limit-reset.js'

// 2026-10-08 20:26 local time, as the daemon sees it.
const NOW = new Date(2026, 9, 8, 20, 26, 0)
const at = (h: number, m: number, dayOffset = 0): number => new Date(2026, 9, 8 + dayOffset, h, m, 0).getTime()

test('Codex: try again at a clock time later today', () => {
  const err = "local codex failed (exit 1): You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:58 PM."
  assert.equal(limitResetAt(err, NOW), at(23, 58))
})

test('a clock time already past means tomorrow', () => {
  assert.equal(limitResetAt('usage limit reached, try again at 9:05 AM', NOW), at(9, 5, 1))
  assert.equal(limitResetAt('usage limit reached, try again at 12:30 AM', NOW), at(0, 30, 1))
})

test('Codex: try again at a date and time (weekly limit)', () => {
  assert.equal(limitResetAt("You've hit your usage limit. Try again at Oct 10th, 2026 3:15 PM.", NOW), new Date(2026, 9, 10, 15, 15).getTime())
})

test('Claude: resets at a clock time', () => {
  assert.equal(limitResetAt('5-hour limit reached ∙ resets 11pm', NOW), at(23, 0))
  assert.equal(limitResetAt('Session limit reached · resets 2:30am (Asia/Taipei)', NOW), at(2, 30, 1))
})

test('Claude: usage limit with an epoch-seconds suffix', () => {
  const reset = at(22, 0)
  assert.equal(limitResetAt(`Claude AI usage limit reached|${reset / 1000}`, NOW), reset)
})

test('try again in a duration', () => {
  const base = NOW.getTime()
  assert.equal(limitResetAt('rate limit: try again in 2 hours 5 minutes', NOW), base + (2 * 60 + 5) * 60_000)
  assert.equal(limitResetAt('Usage limit. Try again in 3 days 1 hour', NOW), base + (3 * 24 + 1) * 3_600_000)
  assert.equal(limitResetAt('try again in 45 seconds', NOW), base + 45_000)
})

test('no reset time, or a nonsensical one, gives null', () => {
  for (const err of [
    'Too many requests',
    '429 rate limit exceeded',
    'try again later',
    'try again at 25:99 PM',
    'Claude AI usage limit reached|12', // 1970
    'try again in 0 minutes',
  ]) {
    assert.equal(limitResetAt(err, NOW), null, err)
  }
})

test('a reset further out than the cap is clamped to it', () => {
  const far = NOW.getTime() + 30 * 24 * 3_600_000
  assert.equal(limitResetAt(`Claude AI usage limit reached|${far / 1000}`, NOW), NOW.getTime() + MAX_LIMIT_WAIT_MS)
})
