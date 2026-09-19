import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

/** Start the two-second hold only after the background has actually loaded. */
export function ResultReveal({ background, backgroundStyle, className = '', children }: {
  background: string; backgroundStyle?: CSSProperties; className?: string; children: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<'background' | 'revealing' | 'ready'>('background')
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => setPhase('revealing'), 2000)
    return () => window.clearTimeout(timer)
  }, [loaded])

  return <div className={`fill result-reveal-screen ${className}`} data-result-phase={phase}>
    <img className="fill" src={background} alt="" style={{ objectFit: 'cover', ...backgroundStyle }}
      onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
    {phase !== 'background' && <div className={`fill result-reveal-ui ${phase === 'revealing' ? 'scene-ui-dissolve' : ''}`}
      aria-hidden={phase !== 'ready'} ref={element => { if (element) element.inert = phase !== 'ready' }}
      onAnimationEnd={event => {
        if (event.target === event.currentTarget && event.animationName === 'sceneUiDissolve') setPhase('ready')
      }}>{children}</div>}
  </div>
}
