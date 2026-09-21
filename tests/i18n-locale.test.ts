/**
 * Locale detection and the Traditional Chinese catalogue.
 *
 * Before zh-TW existed, every `zh*` browser tag landed on Simplified, so a
 * Taiwan / Hong Kong user opened the app in the wrong script. These pin the
 * split: Traditional tags go to zh-TW, the rest of Chinese to zh-CN.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCALES, localeFromTags, translate } from '../src/lib/i18n'
import { en } from '../src/locales/en'
import { zhTW } from '../src/locales/zh-TW'

describe('localeFromTags', () => {
  it('sends Traditional-script tags to zh-TW', () => {
    for (const tag of ['zh-TW', 'zh-Hant', 'zh-Hant-TW', 'zh-HK', 'zh-MO', 'ZH-tw']) {
      assert.equal(localeFromTags([tag]), 'zh-TW', tag)
    }
  })

  it('sends every other Chinese tag to zh-CN', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG', 'zh-Hans-CN']) {
      assert.equal(localeFromTags([tag]), 'zh-CN', tag)
    }
  })

  it('honours preference order and falls back to English', () => {
    assert.equal(localeFromTags(['en-US', 'zh-TW']), 'en')
    assert.equal(localeFromTags(['fr-FR', 'zh-TW']), 'zh-TW')
    assert.equal(localeFromTags(['fr-FR', 'de']), 'en')
    assert.equal(localeFromTags([undefined, '']), 'en')
  })
})

describe('zh-TW catalogue', () => {
  it('is offered in the language picker', () => {
    assert.ok(LOCALES.some((l) => l.code === 'zh-TW' && l.label === '繁體中文'))
  })

  it('mirrors every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in zhTW))
    assert.deepEqual(missing, [])
  })

  it('only uses {placeholders} the English string provides', () => {
    // Chinese has no plural forms, so dropping e.g. {plural} is fine; a
    // placeholder English never fills would render as literal `{x}`.
    const vars = (s: string) => new Set(s.match(/\{\w+\}/g) ?? [])
    for (const [key, tw] of Object.entries(zhTW)) {
      const source = vars(en[key as keyof typeof en])
      for (const v of vars(tw ?? '')) assert.ok(source.has(v), `${key}: ${v}`)
    }
  })

  it('uses Taiwan wording for the words people see most', () => {
    assert.equal(translate('zh-TW', 'common.signOut'), '登出')
    assert.equal(translate('zh-TW', 'common.save'), '儲存')
    assert.equal(translate('zh-TW', 'push.deleteTitle'), '刪除帳號')
  })

  it('contains no Simplified-only characters', () => {
    const simplified = /[们这说对时发会过还让经东该请见个为无线开关应复题数据设录网络软视频]/
    for (const [key, tw] of Object.entries(zhTW)) {
      assert.ok(!simplified.test(tw ?? ''), `${key}: ${tw}`)
    }
  })
})
