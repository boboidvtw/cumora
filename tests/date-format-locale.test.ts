/**
 * Dates and times on screen follow the in-app language, not the browser's.
 * `toLocale*String()` with no locale, `undefined` or `[]` silently uses the
 * browser's, so someone who picked 繁體中文 in an English browser got
 * English dates. Pass `currentLocale()` (or `useLocale()` in a component
 * that must re-render on a switch). Upstream merges can bring new calls
 * back; this catches them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { currentLocale, useLocaleStore } from '../src/lib/i18n.ts'

const SRC = new URL('../src/', import.meta.url).pathname
const BROWSER_LOCALE = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b|\[\s*\])/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

test('no date or time is formatted in the browser locale', () => {
  const hits = sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8').split('\n').flatMap((line, i) =>
      BROWSER_LOCALE.test(line) ? [`${file.slice(SRC.length)}:${i + 1}`] : []))
  assert.deepEqual(hits, [])
})

test('currentLocale reads the in-app choice', () => {
  const before = useLocaleStore.getState().locale
  try {
    useLocaleStore.setState({ locale: 'zh-TW' })
    assert.equal(currentLocale(), 'zh-TW')
    useLocaleStore.setState({ locale: 'en' })
    assert.equal(currentLocale(), 'en')
  } finally {
    useLocaleStore.setState({ locale: before })
  }
})
