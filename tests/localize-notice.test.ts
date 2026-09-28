import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translate, type MessageKey } from '../src/lib/i18n'
import { localizeNotice } from '../src/lib/localize-notice'

const zhTW = (key: MessageKey, vars?: Record<string, string | number>) => translate('zh-TW', key, vars)
const en = (key: MessageKey, vars?: Record<string, string | number>) => translate('en', key, vars)

const daemonText =
  'Atlas could not run on local claude: local claude failed (exit 1): 401 invalid token\n' +
  'Open Claude Code on that computer and sign in, refresh quota, or add credits, then wake the agent again.'

test('an engine-failure notice is framed and hinted in the viewer\'s language', () => {
  assert.equal(
    localizeNotice('byoa_engine_failed', daemonText, zhTW),
    'Atlas 沒辦法在本機的 claude 上執行：local claude failed (exit 1): 401 invalid token\n' +
    '在那台電腦上打開 Claude Code 登入、更新額度或加值，然後再喚醒智能體一次。',
  )
})

test('English viewers see the daemon\'s sentence unchanged', () => {
  assert.equal(localizeNotice('byoa_engine_failed', daemonText, en), daemonText)
})

test('an unknown hint keeps the translated frame and the original hint', () => {
  const text = 'Kai could not run on local grok: boom\nOpen Grok Build on that computer and run `grok login`.'
  assert.equal(
    localizeNotice('byoa_engine_failed', text, zhTW),
    'Kai 沒辦法在本機的 grok 上執行：boom\nOpen Grok Build on that computer and run `grok login`.',
  )
})

test('multi-line engine output stays verbatim', () => {
  const text = 'Hermes could not run on local hermes: line one\nline two\nCheck the daemon terminal for details, then wake the agent again.'
  assert.equal(
    localizeNotice('byoa_engine_failed', text, zhTW),
    'Hermes 沒辦法在本機的 hermes 上執行：line one\nline two\n請到常駐程式的終端機查看細節，然後再喚醒智能體一次。',
  )
})

test('other notices and unrecognised shapes pass through', () => {
  assert.equal(localizeNotice('quota_exhausted', 'Out of quota.', zhTW), 'Out of quota.')
  assert.equal(localizeNotice('byoa_engine_failed', 'something else entirely', zhTW), 'something else entirely')
  assert.equal(localizeNotice(undefined, 'x', zhTW), 'x')
})
