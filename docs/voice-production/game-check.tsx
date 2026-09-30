// Local-only preview of production screens. This entry is excluded from the application build.
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GameScreen } from '../../src/screens/GameScreen'
import { GameBScreen } from '../../src/screens/GameBScreen'
import { GameCScreen } from '../../src/screens/GameCScreen'
import { GameDScreen } from '../../src/screens/GameDScreen'
import { TutorialScreen } from '../../src/screens/TutorialScreen'
import { initAudio, runNarration } from '../../src/game/audio'
import { poseEngine } from '../../src/game/pose'
import '../../src/styles.css'
import '../../src/game-c.css'

function Check() {
  const clean = new URLSearchParams(location.search).has('clean')
  const [screen, setScreen] = useState('menu')
  const [version, setVersion] = useState(0)
  const [scale, setScale] = useState(1)
  const [trace, setTrace] = useState<string[]>([])
  const toolbar = !clean || screen === 'menu'
  useEffect(() => {
    const resize = () => setScale(Math.min(innerWidth / 1920, (innerHeight - (toolbar ? 104 : 0)) / 1080))
    resize(); window.addEventListener('resize', resize)
    // No webcam request; the normal keyboard fallback feeds production gesture logic.
    poseEngine.ready = true; poseEngine.cameraOk = false
    return () => window.removeEventListener('resize', resize)
  }, [toolbar])
  useEffect(() => {
    if (screen === 'result') return runNarration('common_result')
  }, [screen, version])
  useEffect(() => {
    let previous = ''
    const timer = window.setInterval(() => {
      const root = document.querySelector('[data-response-open]') as HTMLElement | null
      if (!root) return
      const state = JSON.stringify(root.dataset)
      if (state !== previous) { previous = state; setTrace(lines => [...lines.slice(-7), `${(performance.now() / 1000).toFixed(2)}s ${state}`]) }
    }, 25)
    return () => window.clearInterval(timer)
  }, [screen, version])
  const start = (value: string) => { void initAudio(); setTrace([]); setScreen(value); setVersion(n => n + 1) }
  const done = () => setScreen('result')
  // The A preview cannot enter scored play: unmount at the end of its practice.
  useEffect(() => {
    if (screen !== 'A') return
    const timer = window.setInterval(() => {
      if (document.querySelector('.game-fade-out')) setScreen('menu')
    }, 25)
    return () => window.clearInterval(timer)
  }, [screen])
  return <>
    {toolbar && <nav style={{ position: 'absolute', inset: '0 0 auto', height: 104, padding: 12, background: '#f3f0e9', zIndex: 100, fontFamily: 'sans-serif' }}>
      <p style={{ marginBottom: 8 }}>안내 음성 점검 · 장보기 E/I · 다른 게임 Q/W, O/P · 1 건너뛰기</p>
      {['A', 'B 연습', 'B 본게임', 'C 연습', 'C 본게임', '토끼 선택 준비', 'D 연습', 'D 본게임', 'result', 'menu'].map(value =>
        <button key={value} onClick={() => start(value)} style={{ marginRight: 8, padding: '5px 10px' }}>{value === 'result' ? '결과 음성' : value === 'menu' ? '닫기' : value}</button>)}
    </nav>}
    <div style={{ position: 'absolute', top: toolbar ? 104 : 0, bottom: 0, width: '100%' }}>
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }} key={version}>
        {screen === 'A' && <GameScreen avatars={{ p1: 'grandma', p2: 'grandfa' }} onFinish={done} />}
        {screen.startsWith('B') && <GameBScreen avatars={{ p1: 'grandma', p2: 'grandfa' }} skipPractice={screen.endsWith('본게임')} onFinish={done} onExit={() => setScreen('menu')} />}
        {screen.startsWith('C') && <GameCScreen rabbits={{ p1: 'pink', p2: 'brown' }} skipPractice={screen.endsWith('본게임')} onFinish={done} onExit={() => setScreen('menu')} />}
        {screen.startsWith('D') && <GameDScreen shoppers={{ p1: 'male', p2: 'female' }} skipPractice={screen.endsWith('본게임')} onFinish={done} onExit={() => setScreen('menu')} />}
        {screen === '토끼 선택 준비' && <TutorialScreen game="ricecake" onDone={() => setScreen('C 연습')} />}
        {(screen === 'menu' || screen === 'result') && <p style={{ margin: 80, color: 'white', fontSize: 54 }}>{screen === 'result' ? '수고하셨어요. 함께 만든 결과를 확인해 볼까요?' : '위에서 점검할 게임을 선택해 주세요.'}</p>}
      </div>
    </div>
    {!clean && <details style={{ position: 'absolute', bottom: 0, left: 0, maxWidth: '100%', background: '#fff', zIndex: 110, font: '11px monospace' }}>
      <summary>전환 기록</summary><pre id="transition-log">{trace.join('\n')}</pre>
    </details>}
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<React.StrictMode><Check /></React.StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
