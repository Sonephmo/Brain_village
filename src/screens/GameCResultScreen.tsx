import { GameTools } from '../components/GameTools'
import { useEffect } from 'react'
import { RESULT } from '../assets'
import { Sprite } from '../components/Sprite'
import { ResultReveal } from '../components/ResultReveal'
import { RabbitPortrait } from '../components/GameCRabbit'
import { GAME_C_IMAGES } from '../game/gameCAssets'
import { GAME_C_RULES, ricePlayerStats, type GameCResult, type Rabbits } from '../game/gameC'
import { playBgm, stopBgm } from '../game/bgm'
import { downloadJson } from '../game/logging'

export function GameCResultScreen({ result, rabbits, onReplay, onVillage, onTitle }: {
  result: GameCResult; rabbits: Rabbits; onReplay: () => void; onVillage: () => void; onTitle: () => void
}) {
  useEffect(() => { playBgm('report'); return () => stopBgm() }, [])
  const success = result.completed && result.score >= GAME_C_RULES.passScore
  return <ResultReveal background={GAME_C_IMAGES.backgrounds[success ? 1 : 0]} className="game-c-result">
    <Sprite frame={RESULT.banner} style={{ left: 710, top: 51, width: 500, height: 137 }} />
    <p className="game-c-result-summary">{result.completed ? success ? '쫀득쫀득한 떡 완성!' : '다음에는 더 쫀득하게!' : '여기까지 함께했어요'} · {result.score}점</p>
    {([1, 2] as const).map((pid, i) => {
      const stats = ricePlayerStats(result, pid)
      return <section key={pid} aria-label={`P${pid} 결과`}>
        <img src={GAME_C_IMAGES.panels[i]} alt="" style={{ position: 'absolute', left: 161 + i * 920, top: 482, width: 700, height: 363 }} />
        <div className="game-c-result-portrait" style={{ left: 261 + i * 920 }}>
          <img src={GAME_C_IMAGES.cards[i]} alt="" className="fill" />
          <RabbitPortrait rabbit={pid === 1 ? rabbits.p1 : rabbits.p2} style={{ left: 157, top: -2, width: 185, height: 312 }} />
        </div>
        <div className="game-c-rating" style={{ left: 336 + i * 920 }} aria-label={`떡 ${stats.rating}개 / 5개`}>
          {Array.from({ length: 5 }, (_, n) => <img key={n} src={GAME_C_IMAGES.rating[n < stats.rating ? 1 : 0]} alt="" />)}
        </div>
        <div className="game-c-result-feedback" style={{ left: 209 + i * 920 }}>
          <p>정확한 동작 {stats.correct}회</p>
          <p>다른 동작 {stats.wrong}회 · 무반응 {stats.missed}회</p>
          <p>{stats.total} / 10회 진행</p>
        </div>
      </section>
    })}
    <p className="game-c-result-status">{result.completed
      ? success ? result.finishPoseCompleted ? '마무리 동작까지 함께했어요' : '마무리 동작은 건너뛰었어요' : '두 라운드를 마쳤어요'
      : '중단 전 완료한 동작만 기록했어요'}</p>
    {([
      ['btnRetry', '다시하기', 445, onReplay], ['btnYes', '확인', 800, onVillage], ['btnHome', '홈으로', 1155, onTitle],
    ] as const).map(([key, label, left, action]) => <button className="game-c-result-button" key={key} aria-label={label} onClick={action} style={{ left }}>
      <Sprite frame={RESULT[key]} style={{ inset: 0, width: '100%', height: '100%' }} />
    </button>)}
    <GameTools><button className="pixel-btn secondary" onClick={() => downloadJson({ ...result, rabbits }, `youngcha_gameC_${Date.now()}.json`)}>기록 내려받기</button></GameTools>
  </ResultReveal>
}
