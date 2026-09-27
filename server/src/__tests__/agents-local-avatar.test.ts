import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderLocalAvatar, type LocalAvatarLook } from '../agents/local-avatar.js'

const look: LocalAvatarLook = {
  skin: 'warm cream',
  hairColor: 'deep auburn',
  hairStyle: 'a single low ponytail with face-framing strands',
  glasses: 'thin gold wire-frames worn low on the bridge',
  gender: 'feminine',
}

test('the same agent gets the same portrait on every re-roll', () => {
  assert.equal(renderLocalAvatar(look, 42), renderLocalAvatar(look, 42))
})

test('the visual signature shows up in the drawing', () => {
  const svg = renderLocalAvatar(look, 42)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="0 0 512 512"/)
  assert.ok(svg.endsWith('</svg>'))
  assert.ok(svg.includes('#F1D3B3'), 'cream skin')
  assert.ok(svg.includes('#7A2E1F'), 'auburn hair')
  assert.ok(svg.includes('stroke="#C9A24A"'), 'gold frames')
  assert.notEqual(svg, renderLocalAvatar({ ...look, glasses: 'no glasses' }, 42))
})

test('different agents get different wardrobe and backdrop', () => {
  const seen = new Set(Array.from({ length: 8 }, (_, i) => renderLocalAvatar(look, i * 2654435761)))
  assert.ok(seen.size >= 6, `only ${seen.size} distinct portraits out of 8`)
})

test('the SVG never carries script or external references', () => {
  const svg = renderLocalAvatar({ ...look, hairStyle: '<script>alert(1)</script>', skin: '"><img src=x>' }, 7)
  assert.doesNotMatch(svg, /<script|<img|href=|javascript:/i)
})
