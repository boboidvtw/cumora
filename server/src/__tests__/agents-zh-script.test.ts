import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toTraditionalTaiwan } from '../agents/zh-script.js'

test('a stray Simplified word inside a Traditional reply is converted', () => {
  assert.equal(toTraditionalTaiwan('今天台北多云，下午可能會下雨。'), '今天台北多雲，下午可能會下雨。')
})

test('Simplified sentences get Taiwan wording, not just characters', () => {
  assert.equal(
    toTraditionalTaiwan('我查了一下信息，这个软件的内存不足，视频也没上传。'),
    '我查了一下資訊，這個軟體的記憶體不足，影片也沒上傳。',
  )
})

test('already-Traditional sentences are left exactly as written', () => {
  // twp alone would rewrite 查看→檢視; these must survive untouched.
  for (const s of [
    '請查看附件，我明天再跟你確認。',
    '他著急地說：「這裡的網路太慢了。」',
    '臺灣的乾燥季節大約從十月開始，這隻貓只吃罐頭。',
    '範本、訊息、登入、帳號、預設、支援、硬碟、螢幕、滑鼠、伺服器',
  ]) assert.equal(toTraditionalTaiwan(s), s)
})

test('only the sentence with Simplified characters is converted', () => {
  assert.equal(
    toTraditionalTaiwan('請查看附件。这个文件很重要。'),
    '請查看附件。這個檔案很重要。',
  )
})

test('code, URLs and email addresses are never touched', () => {
  const input = '发布步骤：`npm run 发布`，文档在 https://example.com/zh-cn/信息 ，有问题寄 fabu-zhichi@example.cn\n```\necho 发布\n```\n完成了'
  const out = toTraditionalTaiwan(input)
  assert.ok(out.startsWith('釋出步驟：`npm run 发布`'), out)
  assert.ok(out.includes('https://example.com/zh-cn/信息 '), out)
  assert.ok(out.includes("有問題寄 fabu-zhichi@example.cn"), out)
  assert.ok(out.includes('```\necho 发布\n```'), out)
  assert.ok(out.endsWith('完成了'), out)
})

test('text without Chinese passes through', () => {
  assert.equal(toTraditionalTaiwan('ok, done — see PR 42'), 'ok, done — see PR 42')
  assert.equal(toTraditionalTaiwan(''), '')
})
