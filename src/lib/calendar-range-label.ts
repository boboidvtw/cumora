import type { Locale } from '@/lib/i18n'

/** The desktop calendar's week header. Intl's range formatter picks the
 *  locale's own way to join two dates ("Oct 4 – 10, 2026", "2026/10/4至
 *  2026/10/10"); gluing two separately formatted halves only works in
 *  English. */
export function weekRangeLabel(start: Date, end: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' })
    .formatRange(start, end)
}
