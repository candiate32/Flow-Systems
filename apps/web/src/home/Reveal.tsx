import type { CSSProperties, ReactNode } from 'react'
import { useInView } from './useInView'

type Props = {
  children: ReactNode
  className?: string
  /** Stagger siblings by passing increasing delays, in ms. */
  delay?: number
}

/** Fades and lifts its content in the first time it scrolls into view. Static with reduced motion. */
export function Reveal({ children, className = '', delay = 0 }: Props) {
  const [ref, shown] = useInView<HTMLDivElement>()
  const style: CSSProperties | undefined = delay ? { transitionDelay: `${delay}ms` } : undefined
  return (
    <div
      ref={ref}
      data-shown={shown || undefined}
      style={style}
      className={`transition-[opacity,translate] duration-[900ms] ease-spring ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  )
}
