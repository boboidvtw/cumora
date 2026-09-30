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
