/**
 * useLongPress — touch-driven long-press detector for mobile rows.
 *
 * Returns the props you spread on the target element. The detector
 * fires `onLongPress(coords)` after 450ms of held touch with no
 * significant movement, passing the original touch position so a
 * context menu can anchor to it. A move past the 10px tap tolerance
 * cancels BOTH the long-press timer and the deferred `onTap` — that
 * way scrolling through a list of pressable rows can't accidentally
 * fire either gesture.
 *
 * Right-click on desktop is treated as a synthetic long-press (the
 * Vite dev server doesn't have a finger), so the same context menu
 * is reachable during development.
 *
 * A plain click also fires `onTap`. This layout is chosen by width, so a
 * narrow desktop window or an iPad with a trackpad gets it too, and
 * those never send touch events — without this, no row would open. A
 * finger's tap ends in a synthetic click as well; that one is skipped
 * because the touch path already handled it.
 */
import { useRef } from 'react'
import { mediumHaptic, tapHaptic } from '@/lib/native'

export interface LongPressCoords {
  x: number
  y: number
}

/** Same tolerance as the touch path: past this, it was a drag, not a tap. */
const TAP_SLOP_PX = 10
/** A touch's synthetic click lands well within this after touchend. */
const TOUCH_CLICK_WINDOW_MS = 800

/** Whether a click should fire `onTap`: a primary-button click that didn't
 *  travel (a swipe-to-reveal drag with the mouse also ends in a click) and
 *  isn't the click a browser synthesizes right after a touch. */
export function clickIsTap(
  click: { button: number; x: number; y: number; at: number },
  down: LongPressCoords | null,
  lastTouchAt: number,
): boolean {
  if (click.button !== 0) return false
  if (click.at - lastTouchAt < TOUCH_CLICK_WINDOW_MS) return false
  if (down && (Math.abs(click.x - down.x) > TAP_SLOP_PX || Math.abs(click.y - down.y) > TAP_SLOP_PX)) return false
  return true
}

export function useLongPress(
  onLongPress: (coords: LongPressCoords) => void,
  onTap?: () => void,
) {
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<LongPressCoords | null>(null)
  const triggeredRef = useRef(false)
  const movedRef = useRef(false)
  const lastTouchAtRef = useRef(Number.NEGATIVE_INFINITY)
  const mouseDownRef = useRef<LongPressCoords | null>(null)

  const clear = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const coords = { x: t.clientX, y: t.clientY }
      lastTouchAtRef.current = Date.now()
      startRef.current = coords
      triggeredRef.current = false
      movedRef.current = false
      clear()
      timerRef.current = window.setTimeout(() => {
        triggeredRef.current = true
        void mediumHaptic()
        onLongPress(coords)
      }, 450)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0]
      if (!t || !startRef.current) return
      const dx = Math.abs(t.clientX - startRef.current.x)
      const dy = Math.abs(t.clientY - startRef.current.y)
      if (dx > 10 || dy > 10) {
        clear()
        movedRef.current = true
      }
    },
    onTouchEnd: () => {
      lastTouchAtRef.current = Date.now()
      clear()
      if (!triggeredRef.current && !movedRef.current && onTap) {
        // Fire haptic on touchEnd — that's the moment we actually
        // commit to firing onTap, so the bzzt is synced to user
        // intent rather than to a touchdown that might have been a
        // scroll attempt.
        void tapHaptic()
        onTap()
      }
    },
    onTouchCancel: () => { clear(); movedRef.current = false },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      onLongPress({ x: e.clientX, y: e.clientY })
    },
    onMouseDown: (e: React.MouseEvent) => {
      mouseDownRef.current = { x: e.clientX, y: e.clientY }
    },
    onClick: (e: React.MouseEvent) => {
      const down = mouseDownRef.current
      mouseDownRef.current = null
      if (!onTap) return
      if (!clickIsTap({ button: e.button, x: e.clientX, y: e.clientY, at: Date.now() }, down, lastTouchAtRef.current)) return
      onTap()
    },
  }
}
