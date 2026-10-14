import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './motion'

/**
 * True once the element has scrolled into view, and stays true: animations
 * play once. Starts true with reduced motion or without IntersectionObserver,
 * so content is never left hidden.
 */
export function useInView<T extends Element>({ threshold = 0, rootMargin = '0px 0px -8% 0px' } = {}) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined' || prefersReducedMotion())

  useEffect(() => {
    const el = ref.current
    if (inView || !el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setInView(true)
        io.disconnect()
      },
      { threshold, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView, threshold, rootMargin])

  return [ref, inView] as const
}
