import { useEffect, useRef, type ReactNode } from 'react'
import './gamePause.css'

export function GamePause({ paused, onPause, onResume, children }: {
  paused: boolean; onPause: () => void; onResume: () => void; children?: ReactNode
}) {
  const resumeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!paused) return
    const overlay = resumeButton.current?.closest('.game-pause-overlay')
    const root = overlay?.parentElement
    const previous = document.activeElement
    const siblings = [...(root?.children ?? [])].filter(child => child !== overlay) as HTMLElement[]
    const inert = siblings.map(child => child.inert)
    siblings.forEach(child => { child.inert = true })
    resumeButton.current?.focus()
    return () => {
      siblings.forEach((child, index) => { child.inert = inert[index] })
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [paused])
  return paused ? <div className="game-pause-overlay" role="dialog" aria-modal="true" aria-label="일시정지" onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, summary, select, input')]
      .filter(element => element.getClientRects().length > 0 && !element.matches(':disabled'))
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <div className="game-pause-card">
      <h2>잠시 쉬어가요</h2>
      <p>시간과 점수는 그대로예요.<br />기본자세로 돌아온 뒤 계속해 주세요.</p>
      <button ref={resumeButton} className="pixel-btn" onClick={onResume}>계속하기</button>
      <details className="game-pause-options"><summary>진행자 설정</summary>
        {children ?? <><p>연습 건너뛰기: 1</p><p>게임 중단: 2를 두 번 누르기</p>
          <p>키보드: 왼쪽 Q / W · 오른쪽 O / P</p></>}
        <p className="game-menu-note">게임 단축키는 계속하기 후 사용할 수 있어요.</p>
      </details>
    </div>
  </div> : <button className="game-pause-button" aria-label="게임 메뉴 열기" title="메뉴 · Esc" onClick={onPause}>Ⅱ</button>
}
