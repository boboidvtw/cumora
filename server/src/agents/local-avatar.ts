/**
 * Offline agent portraits: a flat illustrated SVG drawn from the same visual
 * signature the image-model prompt uses (skin, hair colour, hair style,
 * glasses), so a self-hosted deployment with no image API still gives every
 * agent a distinct face — and the same agent the same face on every re-roll.
 *
 * Used when AVATAR_PROVIDER=local (see generateAndPersistAvatar). No network,
 * no model: LM Studio and other local servers only run text models, so the
 * portrait is rendered here; the text model is only asked for the gender
 * presentation, which picks the hair and wardrobe pools.
 */

export interface LocalAvatarLook {
  skin: string
  hairColor: string
  hairStyle: string
  glasses: string
  gender: 'feminine' | 'masculine' | 'androgynous'
}

/** First pool entry whose keyword appears in the description wins. */
function byKeyword(text: string, table: Array<[string, string]>, fallback: string): string {
  const t = text.toLowerCase()
  return table.find(([k]) => t.includes(k))?.[1] ?? fallback
}

const SKIN: Array<[string, string]> = [
  ['porcelain', '#F6DCCB'], ['ivory', '#F3E0C9'], ['cream', '#F1D3B3'],
  ['beige', '#E6C19C'], ['golden olive', '#D7AA7C'], ['tan', '#C98E62'],
  ['honey', '#D39A68'], ['olive', '#B98859'],
]
const HAIR: Array<[string, string]> = [
  ['raven', '#1C1B24'], ['espresso', '#3B2A22'], ['chestnut', '#6B3A22'],
  ['auburn', '#7A2E1F'], ['honey blonde', '#D9A95B'], ['platinum', '#E7E3DA'],
  ['ash', '#6F6258'], ['copper', '#B8491F'], ['jet black', '#151419'],
  ['green', '#3F5B3A'], ['caramel', '#C2884A'], ['inky', '#121217'],
  ['pastel-pink', '#5A3F33'], ['black', '#1A1A1F'], ['brown', '#4A3326'],
]
const FRAMES: Array<[string, string]> = [
  ['gold', '#C9A24A'], ['tortoiseshell', '#6B4128'], ['clear', '#AEB8BF'], ['black', '#26262B'],
]
const CLOTHES = ['#3E5C76', '#7A4E6D', '#2F6B5B', '#B5654A', '#5B5F97', '#8C6D3F', '#4D6A3A', '#A04A5A', '#37474F', '#C28F2C']
const BACKDROPS = ['#F2E3D5', '#DCE8E2', '#E4E0F2', '#F5DDE0', '#DDE7F2', '#F3EBCF', '#E2EEDB', '#EDE2F0']

type HairShape = 'long' | 'medium' | 'bob' | 'short' | 'curls' | 'coils' | 'bun' | 'ponytail'

function hairShape(style: string): HairShape {
  const s = style.toLowerCase()
  // Cropped cuts first: "a tapered fade with a coiled crown" is short, not a curl halo.
  if (s.includes('fade') || s.includes('cropped') || s.includes('shape-up') || s.includes('undercut')) return s.includes('coil') ? 'coils' : 'short'
  if (s.includes('curls')) return 'curls'
  if (s.includes('ponytail')) return 'ponytail'
  if (s.includes('bun') || s.includes('chignon') || s.includes('topknot')) return 'bun'
  if (s.includes('bob') || s.includes('chin-length')) return 'bob'
  if (s.includes('waist') || s.includes('long') || s.includes('past the shoulder') || s.includes('braids')) return 'long'
  if (s.includes('shoulder') || s.includes('collarbone') || s.includes('medium') || s.includes('mid-length')) return 'medium'
  return 'short'
}

/** Mix a #rrggbb colour toward black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const target = amount < 0 ? 0 : 255
  const a = Math.abs(amount)
  const ch = (v: number) => Math.round(v + (target - v) * a).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

function hairBack(shape: HairShape, color: string): string {
  // Hair that falls behind the head and neck; drawn before the face.
  const bottom = { long: 470, medium: 390, bob: 330, ponytail: 0, bun: 0, short: 0, curls: 0, coils: 0 }[shape]
  if (shape === 'curls') {
    const puffs: string[] = []
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.9 + (i / 13) * 1.2)
      const x = 256 + Math.cos(a) * 118
      const y = 238 + Math.sin(a) * 124
      puffs.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="46"/>`)
    }
    for (const [x, y] of [[150, 300], [362, 300], [140, 250], [372, 250]]) puffs.push(`<circle cx="${x}" cy="${y}" r="42"/>`)
    return `<g fill="${color}">${puffs.join('')}</g>`
  }
  if (shape === 'ponytail') {
    return `<path fill="${color}" d="M330 200 C400 210 410 330 376 420 C366 440 344 436 346 410 C356 330 344 260 320 230 Z"/>`
  }
  if (!bottom) return ''
  return `<path fill="${color}" d="M146 236 C132 66 380 66 366 236 L${shape === 'bob' ? 364 : 378} ${bottom} C330 ${bottom + 18} 182 ${bottom + 18} ${shape === 'bob' ? 148 : 134} ${bottom} Z"/>`
}

function hairFront(shape: HairShape, color: string, fringe: boolean): string {
  if (shape === 'coils') {
    return `<path fill="${color}" d="M166 222 C156 96 356 96 346 222 C330 178 296 162 256 162 C216 162 182 178 166 222 Z"/>`
  }
  const cap = shape === 'short'
    ? `<path fill="${color}" d="M162 232 C142 76 370 76 350 232 C340 186 300 150 256 152 C212 150 172 186 162 232 Z"/>`
    : `<path fill="${color}" d="M158 262 C132 72 380 72 354 262 C346 204 312 166 256 164 C200 166 166 204 158 262 Z"/>`
  const fringePath = fringe
    ? `<path fill="${color}" d="M166 222 C176 150 336 150 346 222 C326 204 300 200 272 212 C246 198 200 198 166 222 Z"/>`
    : ''
  const bun = shape === 'bun' ? `<circle cx="256" cy="120" r="42" fill="${color}"/>` : ''
  return bun + cap + fringePath
}

function glassesSvg(desc: string, y: number): string {
  const d = desc.toLowerCase()
  if (d.startsWith('no ') || d.includes('no glasses')) return ''
  const frame = byKeyword(d, FRAMES, '#3A3A40')
  const pushedUp = d.includes('pushed up')
  const cy = pushedUp ? 168 : y
  const lens = d.includes('rectangular')
    ? (cx: number) => `<rect x="${cx - 28}" y="${cy - 17}" width="56" height="34" rx="8"/>`
    : (cx: number) => `<circle cx="${cx}" cy="${cy}" r="${d.includes('small') ? 22 : d.includes('oversized') ? 31 : 26}"/>`
  return `<g fill="#ffffff" fill-opacity="0.12" stroke="${frame}" stroke-width="${d.includes('thin') || d.includes('wire') ? 4 : 6}">` +
    `${lens(222)}${lens(290)}<path fill="none" d="M248 ${cy} Q256 ${cy - 6} 264 ${cy}"/></g>`
}

/** Render an agent's portrait as a 512×512 SVG. `seed` varies what the visual
 *  signature doesn't cover (wardrobe colour, backdrop); pass a stable hash of
 *  the agent id so re-rolls keep the same face. */
export function renderLocalAvatar(look: LocalAvatarLook, seed: number): string {
  const skin = byKeyword(look.skin, SKIN, '#EBC7A4')
  const hair = byKeyword(look.hairColor, HAIR, '#3B2A22')
  const shape = hairShape(look.hairStyle)
  const style = look.hairStyle.toLowerCase()
  const fringe = style.includes('fringe') || style.includes('forward') || style.includes('bangs') || look.hairColor.includes('fringe')
  const clothes = CLOTHES[(seed >>> 0) % CLOTHES.length]
  const backdrop = BACKDROPS[(seed >>> 7) % BACKDROPS.length]
  const feminine = look.gender === 'feminine'
  const eyeY = 250
  const ink = '#2A211D'

  const streak = look.hairColor.includes('streak')
    ? `<path fill="#E9D8A6" d="M226 166 C236 164 246 166 250 170 C236 188 224 204 214 214 C212 196 216 178 226 166 Z"/>`
    : ''
  const pinkEnds = look.hairColor.includes('pastel-pink') && (shape === 'long' || shape === 'medium' || shape === 'bob')
    ? `<path fill="#EFA7B8" d="M136 ${shape === 'bob' ? 300 : 360} L${shape === 'bob' ? 148 : 134} ${shape === 'long' ? 470 : shape === 'medium' ? 390 : 330} C182 ${shape === 'long' ? 488 : 408} 330 ${shape === 'long' ? 488 : 408} ${shape === 'bob' ? 364 : 378} ${shape === 'long' ? 470 : shape === 'medium' ? 390 : 330} L376 ${shape === 'bob' ? 300 : 360} Z" opacity="0.9"/>`
    : ''

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
    `<rect width="512" height="512" fill="${backdrop}"/>`,
    `<circle cx="256" cy="228" r="200" fill="${shade(backdrop, 0.35)}"/>`,
    // Everything below is drawn on a 512 canvas and scaled up so the face
    // fills a circular crop.
    '<g transform="translate(256 262) scale(1.14) translate(-256 -246)">',
    hairBack(shape, hair),
    pinkEnds,
    // Neck and shoulders.
    `<rect x="224" y="310" width="64" height="80" rx="24" fill="${shade(skin, -0.08)}"/>`,
    `<path fill="${clothes}" d="M84 512 C96 418 168 384 256 384 C344 384 416 418 428 512 Z"/>`,
    feminine
      ? `<path fill="${shade(skin, -0.04)}" d="M214 386 Q256 440 298 386 Z"/>`
      : `<path fill="${shade(clothes, 0.22)}" d="M212 388 L256 432 L300 388 L286 384 L256 412 L226 384 Z"/>`,
    // Head and ears.
    `<ellipse cx="164" cy="258" rx="16" ry="24" fill="${shade(skin, -0.05)}"/>`,
    `<ellipse cx="348" cy="258" rx="16" ry="24" fill="${shade(skin, -0.05)}"/>`,
    `<ellipse cx="256" cy="240" rx="${feminine ? 90 : 94}" ry="108" fill="${skin}"/>`,
    // Face.
    `<g fill="none" stroke="${shade(hair, -0.2)}" stroke-width="${feminine ? 5 : 7}" stroke-linecap="round">` +
      `<path d="M200 ${eyeY - 30} Q222 ${eyeY - 40} 243 ${eyeY - 32}"/><path d="M269 ${eyeY - 32} Q290 ${eyeY - 40} 312 ${eyeY - 30}"/></g>`,
    `<g fill="${ink}"><ellipse cx="222" cy="${eyeY}" rx="${feminine ? 10 : 9}" ry="${feminine ? 12 : 10}"/><ellipse cx="290" cy="${eyeY}" rx="${feminine ? 10 : 9}" ry="${feminine ? 12 : 10}"/></g>`,
    `<g fill="#ffffff"><circle cx="225" cy="${eyeY - 4}" r="3"/><circle cx="293" cy="${eyeY - 4}" r="3"/></g>`,
    `<path fill="none" stroke="${shade(skin, -0.25)}" stroke-width="4" stroke-linecap="round" d="M256 262 Q249 282 260 286"/>`,
    feminine
      ? `<path fill="#C9656B" d="M234 304 Q256 296 278 304 Q256 324 234 304 Z"/>`
      : `<path fill="none" stroke="#A8595A" stroke-width="5" stroke-linecap="round" d="M236 304 Q256 318 276 304"/>`,
    `<g fill="#F08A8A" fill-opacity="${feminine ? 0.28 : 0.14}"><circle cx="204" cy="288" r="15"/><circle cx="308" cy="288" r="15"/></g>`,
    hairFront(shape, hair, fringe),
    streak,
    glassesSvg(look.glasses, eyeY),
    '</g>',
    '</svg>',
  ].filter(Boolean).join('')
}
