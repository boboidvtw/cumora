import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translate, type MessageKey } from '../src/lib/i18n'
import { localizeApiError, KNOWN_API_ERRORS } from '../src/lib/localize-api-error'

const zhTW = (key: MessageKey, vars?: Record<string, string | number>) => translate('zh-TW', key, vars)
const en = (key: MessageKey, vars?: Record<string, string | number>) => translate('en', key, vars)

test('a fixed server message is shown in the viewer\'s language', () => {
  assert.equal(localizeApiError('invitation expired', zhTW), '這個邀請已過期')
  assert.equal(localizeApiError('at least one builder is required before building', zhTW), '開始建造前，至少需要一位負責人')
})

test('templated messages keep their variable parts', () => {
  assert.equal(
    localizeApiError('this invitation is reserved for a@b.co — sign in with that email to accept', zhTW),
    '這個邀請是給 a@b.co 的 —— 請用該電子郵件登入後接受',
  )
  assert.equal(localizeApiError('size out of range (got 99, max 10)', zhTW), '檔案大小超出限制（99 位元組，上限 10）')
  assert.equal(localizeApiError('3 required verification square(s) are not passed', zhTW), '還有 3 個必要的證據方格沒有通過')
})

test('English viewers see the server text unchanged', () => {
  for (const text of [
    'invitation expired',
    'systemPrompt required (at least 10 chars — describe the agent\'s style)',
    'this invitation is reserved for a@b.co — sign in with that email to accept',
    'size out of range (got 99, max 10)',
    'unresolved recipient: bob',
    'github oauth not configured',
    '3 required verification square(s) are not passed',
  ]) assert.equal(localizeApiError(text, en), text)
})

test('every listed server message reads the same in English', () => {
  for (const text of KNOWN_API_ERRORS) assert.equal(localizeApiError(text, en), text)
})

test('unrecognised messages pass through', () => {
  assert.equal(localizeApiError('something new from upstream', zhTW), 'something new from upstream')
})

// Every fixed `{ error }` string in server/src/api is either translated
// (KNOWN_API_ERRORS) or recorded as reviewed in api-errors-reviewed.json
// (API-client validation a person can't reach from the UI). A new string
// from an upstream merge fails here instead of showing up in English.
test('every server error string is translated or reviewed', () => {
  const dir = new URL('../server/src/api/', import.meta.url)
  const patterns = [
    /HttpError\(\s*\d+\s*,\s*(['"])((?:\\.|(?!\1).)*)\1\s*[,)]/g,
    /\berror:\s*(['"])((?:\\.|(?!\1).)*)\1/g,
  ]
  const found = new Set<string>()
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), 'utf8')
    for (const re of patterns) for (const m of source.matchAll(re)) found.add(m[2].replace(/\\(['"])/g, '$1'))
  }
  const reviewed = new Set<string>(JSON.parse(readFileSync(new URL('./api-errors-reviewed.json', import.meta.url), 'utf8')))
  const known = new Set(KNOWN_API_ERRORS)
  const missing = [...found].filter((s) => !known.has(s) && !reviewed.has(s) && localizeApiError(s, zhTW) === s)
  assert.deepEqual(missing, [], 'translate these in localize-api-error.ts or add them to tests/api-errors-reviewed.json')
  assert.ok(found.size > 100, `only ${found.size} server error strings found — did the extraction break?`)
})

test('workspace and computer errors people hit from the UI are translated', () => {
  assert.equal(localizeApiError('type the workspace name exactly to confirm deletion', zhTW), '請完整輸入工作區名稱來確認刪除')
  assert.equal(localizeApiError('invalid pairing token', zhTW), '配對碼無效')
  assert.match(localizeApiError('Free tier agents run on your own computer. Upgrade to Pro to use Cumora Cloud.', zhTW), /沒有 Cumora Cloud/)
})
