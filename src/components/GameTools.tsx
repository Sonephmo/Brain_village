import type { ReactNode } from 'react'
import './gamePause.css'

/** Secondary tools stay out of the participant's path until deliberately opened. */
export function GameTools({ children }: { children: ReactNode }) {
  return <details className="game-tools">
    <summary aria-label="진행 메뉴">···</summary>
    <div className="game-tools-panel">{children}</div>
  </details>
}
