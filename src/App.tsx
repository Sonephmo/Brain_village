import { useEffect, useState } from 'react'
import { TitleScreen } from './screens/TitleScreen'
import { VillageScreen } from './screens/VillageScreen'
import { TutorialScreen, type AvatarPick } from './screens/TutorialScreen'
import { GameScreen } from './screens/GameScreen'
import { ResultScreen } from './screens/ResultScreen'
import { HandCursor } from './components/HandCursor'
import type { CommandLog } from './game/types'

type Screen = 'title' | 'village' | 'tutorial' | 'game' | 'result'

// 화면 플로우 (스펙 §2): 메인 → 마을 → 튜토리얼 → 오락가락 청기백기 → 결과
export default function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [avatars, setAvatars] = useState<{ p1: AvatarPick; p2: AvatarPick }>({ p1: 'grandma', p2: 'grandfa' })
  const [result, setResult] = useState<{ logs: CommandLog[]; score: number }>({ logs: [], score: 0 })
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const onResize = () =>
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="stage-wrap">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {screen === 'title' && <TitleScreen onStart={() => setScreen('village')} />}
        {screen === 'village' && <VillageScreen onEnterGame={() => setScreen('tutorial')} />}
        {screen === 'tutorial' && (
          <TutorialScreen
            onDone={picked => {
              setAvatars(picked)
              setScreen('game')
            }}
          />
        )}
        {screen === 'game' && (
          <GameScreen
            avatars={avatars}
            onFinish={(logs, score) => {
              setResult({ logs, score })
              setScreen('result')
            }}
          />
        )}
        {screen === 'result' && (
          <ResultScreen
            logs={result.logs}
            score={result.score}
            avatars={avatars}
            onRestart={() => setScreen('village')}
            onTitle={() => setScreen('title')}
          />
        )}
      </div>

      {/*
        손 제스처 커서는 **스테이지 밖**에 둔다.
        스테이지에는 scale 변형이 걸려 있고, 변형된 조상은 position:fixed 자손의
        컨테이닝 블록이 되어 배율이 그대로 적용된다. 안쪽에 두면 마우스 커서와
        크기가 어긋나므로 여기서 화면 좌표로 그린다.
        손이 잡히지 않으면 스스로 아무것도 렌더하지 않는다.
      */}
      <HandCursor />
    </div>
  )
}
