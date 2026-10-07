import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekRangeLabel } from '../src/lib/calendar-range-label.ts'

// Week of Sun 2026-10-04. Before this helper the desktop header stitched two
// toLocaleDateString calls together, which in Chinese came out as
// "10月4日 – 2026年 (日: 10日)".
const sun = new Date(2026, 9, 4)
// ICU puts thin spaces around the dash; compare on plain spaces.
const plain = (s: string) => s.replace(/\s/g, ' ')

test('week range reads as one date range in Chinese', () => {
  const label = weekRangeLabel(sun, new Date(2026, 9, 10), 'zh-TW')
  assert.doesNotMatch(label, /\(/)
  assert.match(label, /2026/)
  assert.match(label, /至/)
})

test('week range keeps the compact English form', () => {
  assert.equal(plain(weekRangeLabel(sun, new Date(2026, 9, 10), 'en')), 'Oct 4 – 10, 2026')
  assert.equal(plain(weekRangeLabel(new Date(2026, 9, 29), new Date(2026, 10, 3), 'en')), 'Oct 29 – Nov 3, 2026')
  assert.equal(plain(weekRangeLabel(new Date(2025, 11, 28), new Date(2026, 0, 3), 'en')), 'Dec 28, 2025 – Jan 3, 2026')
})
