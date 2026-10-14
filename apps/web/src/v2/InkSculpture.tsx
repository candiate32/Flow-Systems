import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './motion'

// A generative "ink" sculpture: a twisted ribbon of fine strands wound along a
// (2, 3) torus knot, drawn in perspective on a canvas. It turns slowly, can be
// dragged to rotate and coasts to a stop. Purely decorative.

const STRANDS = 64
const SAMPLES = 220
const R = 1.05 // knot's main radius
const r = 0.42 // knot's tube radius
const RIBBON = 0.34 // half-width of the ribbon of strands
const IDLE_SPIN = 0.0022 // radians per frame when nobody is dragging
const FRICTION = 0.94

type Vec = [number, number, number]

/** The strand at `s` in [-1, 1] across the ribbon, at parameter `t`, at time `time`. */
function strandPoint(s: number, t: number, time: number): Vec {
  const p = 2
  const q = 3
  const ring = R + r * Math.cos(q * t)
  const cx = ring * Math.cos(p * t)
  const cy = ring * Math.sin(p * t)
  const cz = r * Math.sin(q * t)
  // Twist the ribbon around the knot; the twist breathes over time like wet ink.
  const theta = 1.5 * t + time * 0.35 + 0.45 * Math.sin(2 * t + time * 0.6)
  const width = RIBBON * (0.65 + 0.35 * Math.sin(3 * t - time * 0.4))
  const off = s * width
  return [
    cx + off * Math.cos(theta) * Math.cos(p * t),
    cy + off * Math.cos(theta) * Math.sin(p * t),
    cz + off * Math.sin(theta),
  ]
}

export function InkSculpture({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = prefersReducedMotion()
    let yaw = 0.6
    let pitch = -0.55
    let vYaw = 0
    let vPitch = 0
    let time = 0
    let dragging = false
    let lastX = 0
    let lastY = 0
    let lastMove = 0
    let visible = true
    let frame = 0
    let size = { w: 0, h: 0, dpr: 1 }

    function resize() {
      if (!canvas || !ctx) return
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      size = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function draw() {
      if (!ctx) return
      const { w, h } = size
      ctx.clearRect(0, 0, w, h)
      if (!w || !h) return
      const scale = Math.min(w, h) * 0.3
      const cyw = Math.cos(yaw)
      const syw = Math.sin(yaw)
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      const camera = 4.2
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'

      for (let i = 0; i < STRANDS; i++) {
        const s = (i / (STRANDS - 1)) * 2 - 1
        // Strands at the ribbon's edges are finer and fainter, like ink thinning out.
        const edge = 1 - Math.abs(s)
        ctx.beginPath()
        let depthSum = 0
        for (let j = 0; j <= SAMPLES; j++) {
          const t = (j / SAMPLES) * Math.PI * 2
          const [x, y, z] = strandPoint(s, t, time)
          // Rotate: yaw about the vertical axis, then pitch about the horizontal one.
          const x1 = x * cyw + z * syw
          const z1 = -x * syw + z * cyw
          const y2 = y * cp - z1 * sp
          const z2 = y * sp + z1 * cp
          const persp = camera / (camera - z2)
          const px = w / 2 + x1 * scale * persp
          const py = h / 2 + y2 * scale * persp
          depthSum += z2
          if (j === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        const depth = depthSum / (SAMPLES + 1) // roughly -1 (back) to 1 (front)
        const alpha = 0.05 + 0.16 * edge + 0.05 * depth
        ctx.strokeStyle = `rgba(244, 244, 245, ${Math.max(0.03, alpha).toFixed(3)})`
        ctx.lineWidth = 0.6 + 0.9 * edge
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    function tick() {
      frame = 0
      if (!dragging) {
        yaw += vYaw + (reduced ? 0 : IDLE_SPIN)
        pitch += vPitch
        vYaw *= FRICTION
        vPitch *= FRICTION
      }
      if (!reduced) time += 0.012
      pitch = Math.max(-1.2, Math.min(1.2, pitch))
      draw()
      const coasting = Math.abs(vYaw) + Math.abs(vPitch) > 0.0004
      if (visible && !document.hidden && (!reduced || dragging || coasting)) schedule()
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(tick)
    }

    function onPointerDown(e: PointerEvent) {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      vYaw = 0
      vPitch = 0
      canvas?.setPointerCapture(e.pointerId)
      schedule()
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      lastMove = performance.now()
      vYaw = dx * 0.006
      vPitch = dy * 0.006
      yaw += vYaw
      pitch += vPitch
      schedule()
    }
    function onPointerUp(e: PointerEvent) {
      dragging = false
      // No coasting with reduced motion, or when the pointer had come to rest before release.
      if (reduced || performance.now() - lastMove > 80) {
        vYaw = 0
        vPitch = 0
      }
      if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      schedule()
    }
    function onVisibility() {
      if (!document.hidden) schedule()
    }

    resize()
    draw()
    if (!reduced) schedule()

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      resize()
      draw()
    })
    ro?.observe(canvas)
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
            if (visible && !reduced) schedule()
          })
    io?.observe(canvas)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
      io?.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // touch-action: pan-y keeps vertical page scroll on phones; sideways drags turn the sculpture.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="ink-sculpture"
      className={`block size-full cursor-grab touch-pan-y active:cursor-grabbing ${className}`}
    />
  )
}
