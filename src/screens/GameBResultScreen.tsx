import { useEffect } from 'react'
import { RESULT, type Avatar } from '../assets'
import { Sprite } from '../components/Sprite'
import { ResultReveal } from '../components/ResultReveal'
import { GameBAvatar } from '../components/GameBAvatar'
import { FIRE_FRAMES, GAME_B_REPORT } from '../game/gameBAssets'
import { playBgm, stopBgm } from '../game/bgm'
import { downloadJson } from '../game/logging'
import type { GameBResult } from './GameBScreen'

export function GameBResultScreen({ result, avatars, onReplay, onVillage, onTitle }: {
  result: GameBResult; avatars: { p1: Avatar; p2: Avatar }
  onReplay: () => void; onVillage: () => void; onTitle: () => void
}) {
  useEffect(() => { playBgm('report'); return () => stopBgm() }, [])
  return <ResultReveal background={GAME_B_REPORT.background} className="game-b-result">
    <Sprite frame={RESULT.banner} style={{ left: 710, top: 51, width: 500, height: 137 }} />
    {([0, 1] as const).map(i => {
      const success = result.events.filter(e => e.players[i]).length
      const total = result.events.length
      const flames = total ? Math.round(success / total * 5) : 0
      return <section key={i} aria-label={`P${i + 1} 결과`}>
        <img src={GAME_B_REPORT.panels[i]} alt="" style={{ position: 'absolute', left: 161 + i * 920, top: 482, width: 700, height: 363 }} />
        <div className="game-b-portrait" style={{ left: 261 + i * 920 }}>
          <img src={GAME_B_REPORT.cards[i]} alt="" className="fill" />
          <GameBAvatar avatar={i === 0 ? avatars.p1 : avatars.p2} pose="tutorial" width={411} left={250} top={12} />
          <span className={`game-b-player-label player-${i + 1}`}>P{i + 1}</span>
        </div>
        <div className="game-b-rating" style={{ left: 366 + i * 920 }} role="img" aria-label={`불꽃 ${flames}개 / 5개`}>
          {Array.from({ length: 5 }, (_, n) => <span key={n} className="game-b-rating-flame">
            <img src={n < flames ? FIRE_FRAMES.stand[0] : GAME_B_REPORT.emptyFlame} alt="" className={n < flames ? 'lit' : ''} />
          </span>)}
        </div>
        <div className="game-b-result-feedback" style={{ left: 229 + i * 920 }}>
          <p>{total === 0 ? '다음에 함께해요!' : success === total ? '참 잘했어요!' : '수고했어요!'}</p>
          <p className="game-b-result-detail">{total ? `${total}번 중 ${success}번 성공` : '완료한 동작이 없어요'}</p>
          <p className="game-b-result-status">{result.completed ? '끝까지 함께했어요' : '중단 전 완료한 동작 기준'}</p>
        </div>
      </section>
    })}
    {([
      ['btnRetry', '다시하기', 445, onReplay],
      ['btnYes', '확인', 800, onVillage],
      ['btnHome', '홈으로', 1155, onTitle],
    ] as const).map(([key, label, left, action]) => <button key={key} aria-label={label} onClick={action} className="game-b-result-button" style={{ left }}>
      <Sprite frame={RESULT[key]} style={{ inset: 0, width: '100%', height: '100%' }} />
    </button>)}
    <button className="pixel-btn secondary staff-skip" style={{ top: 18, bottom: 'auto' }} onClick={() => downloadJson({ game: '펄럭펄럭 불피우기', ...result }, `brainvillage_gameB_${Date.now()}.json`)}>결과 JSON (초안)</button>
  </ResultReveal>
}
