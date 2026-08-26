import { useEffect, useState } from 'react'
import { TitleScreen } from './screens/TitleScreen'
import { VillageScreen } from './screens/VillageScreen'
import { TutorialScreen, type AvatarPick } from './screens/TutorialScreen'
import { GameScreen } from './screens/GameScreen'
import { ResultScreen } from './screens/ResultScreen'
import { SiteLoginScreen } from './screens/SiteLoginScreen'
import { PlayerLoginScreen } from './screens/PlayerLoginScreen'
import { logoutPlayers, logoutSite, playerAuth, siteAuth } from './game/auth'
import { HandCursor, useHandControl, usePoseMode } from './components/HandCursor'
import type { CommandLog } from './game/types'

type Screen = 'siteLogin' | 'playerLogin' | 'title' | 'village' | 'tutorial' | 'game' | 'result'

/** 로그인 상태를 보고 들어갈 첫 화면을 정한다. 기관 로그인은 기기에 남아 있다. */
function firstScreen(): Screen {
  if (!siteAuth()) return 'siteLogin'
  if (!playerAuth()) return 'playerLogin'
  return 'title'
}

// 화면 플로우 (스펙 §2, §26):
//   기관 로그인 → 개인 로그인 → 메인 → 마을 → 튜토리얼 → 오락가락 청기백기 → 결과
// 기관 로그인은 수동으로 끄지 않는 이상 유지되므로, 두 번째 실행부터는 개인 로그인이 첫 화면이다.
export default function App() {
  const [screen, setScreen] = useState<Screen>(firstScreen)
  const [avatars, setAvatars] = useState<{ p1: AvatarPick; p2: AvatarPick }>({ p1: 'grandma', p2: 'grandfa' })
  const [result, setResult] = useState<{ logs: CommandLog[]; score: number }>({ logs: [], score: 0 })
  // 결과의 '다시하기'는 튜토리얼을 다시 거치지 않고 본게임만 새로 시작한다.
  // GameScreen은 내부 상태(구령 진행·점수)를 갖고 있으므로 key를 바꿔 새로 마운트시킨다.
  const [runId, setRunId] = useState(0)
  const [skipPractice, setSkipPractice] = useState(false)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const onResize = () =>
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 손 커서는 모든 화면에서 살아 있다. 화면 성격에 따라 포즈 인식 모드만 바꾼다.
  //  - 커서만 필요한 화면(타이틀·마을·결과) → menu: 전체 프레임 1회 추론
  //  - 2인 판정이 필요한 화면(튜토리얼·게임) → game: 절반씩 2회 추론.
  //    커서는 1P 오른손 손목을 재사용하므로 추가 추론이 없다.
  usePoseMode(screen === 'tutorial' || screen === 'game' ? 'game' : 'menu')

  // 손 제스처(주먹 클릭)는 **본게임 화면에서만 끈다.**
  //  - 참가자가 구령에 맞춰 손을 드는 중이라 주먹이 섞여 들어와 오클릭이 날 수 있다
  //    (특히 진행요원용 '중단하기' 버튼)
  //  - 제스처 모델이 GPU를 나눠 쓰지 않게 되어 판정 fps가 8 → 12로 돌아온다
  // 결과(리포트) 화면에서 다시 켜져 손으로 다시하기/처음으로를 고를 수 있다.
  // 손 제스처(주먹 클릭)를 끄는 화면:
  //  - 본게임: 참가자가 구령에 맞춰 손을 드는 중이라 주먹이 섞여 들어온다
  //  - 기관 로그인: 텍스트 입력 화면이라 오클릭이 곤란하다 (진행요원이 키보드로 한다)
  // 개인 로그인은 큰 키패드라 손으로도 누를 수 있게 켜 둔다.
  useHandControl(screen !== 'game' && screen !== 'siteLogin', 1000)

  return (
    <div className="stage-wrap">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {screen === 'siteLogin' && <SiteLoginScreen onDone={() => setScreen('playerLogin')} />}
        {screen === 'playerLogin' && <PlayerLoginScreen onDone={() => setScreen('title')} />}
        {screen === 'title' && (
          <TitleScreen
            onStart={() => setScreen('village')}
            onLogoutSite={() => {
              logoutSite()
              setScreen('siteLogin')
            }}
            onLogoutPlayers={() => {
              logoutPlayers()
              setScreen('playerLogin')
            }}
          />
        )}
        {screen === 'village' && <VillageScreen onEnterGame={() => setScreen('tutorial')} />}
        {screen === 'tutorial' && (
          <TutorialScreen
            onDone={picked => {
              setAvatars(picked)
              setSkipPractice(false)
              setScreen('game')
            }}
          />
        )}
        {screen === 'game' && (
          <GameScreen
            key={runId}
            avatars={avatars}
            skipPractice={skipPractice}
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
            onReplay={() => {
              setSkipPractice(true)
              setRunId(n => n + 1)
              setScreen('game')
            }}
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
