/**
 * Mobile conversation rows must open on a mouse click, not only on touch.
 *
 * The mobile layout is picked by window width, so a narrow desktop window or
 * an iPad with a trackpad renders it with no touch events at all. The rows'
 * onClick only called preventDefault(), so nothing opened. A click now fires
 * onTap unless it is the synthetic click after a finger's tap (already handled
 * on touchend) or the end of a mouse drag (swipe-to-reveal).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let clickIsTap: typeof import('../src/mobile/useLongPress')['clickIsTap']

before(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  })
  clickIsTap = (await server.ssrLoadModule('/src/mobile/useLongPress.ts')).clickIsTap
})

after(async () => {
  await server?.close()
})

const NO_TOUCH = Number.NEGATIVE_INFINITY

describe('clickIsTap', () => {
  it('a still mouse click is a tap', () => {
    assert.equal(clickIsTap({ button: 0, x: 100, y: 200, at: 5_000 }, { x: 101, y: 199 }, NO_TOUCH), true)
  })

  it('a keyboard click (no mousedown) is a tap', () => {
    assert.equal(clickIsTap({ button: 0, x: 0, y: 0, at: 5_000 }, null, NO_TOUCH), true)
  })

  it('the click a finger tap synthesizes is not a second tap', () => {
    assert.equal(clickIsTap({ button: 0, x: 100, y: 200, at: 5_300 }, null, 5_000), false)
  })

  it('a click long after the last touch is a tap again', () => {
    assert.equal(clickIsTap({ button: 0, x: 100, y: 200, at: 9_000 }, { x: 100, y: 200 }, 5_000), true)
  })

  it('the end of a mouse drag is not a tap', () => {
    assert.equal(clickIsTap({ button: 0, x: 40, y: 200, at: 5_000 }, { x: 120, y: 200 }, NO_TOUCH), false)
  })

  it('a non-primary button is not a tap', () => {
    assert.equal(clickIsTap({ button: 1, x: 100, y: 200, at: 5_000 }, { x: 100, y: 200 }, NO_TOUCH), false)
  })
})

it('conversation rows and pinned tiles pass clicks to the long-press hook', async () => {
  const source = await readFile(new URL('../src/mobile/MobileChatList.tsx', import.meta.url), 'utf8')
  const spreads = source.split('{...press}').length - 1
  const forwards = source.split('press.onClick(e)').length - 1
  assert.ok(spreads >= 2, 'the rows no longer spread useLongPress; this guard needs updating')
  assert.equal(forwards, spreads, 'a row overrides onClick without calling press.onClick, so mouse clicks do nothing')
})
