import { GameTools } from '../components/GameTools'
import { useEffect } from 'react'
import { GameDArt } from '../components/GameDArt'
import { GameDShopper } from '../components/GameDShopper'
import { GAME_D_IMAGES } from '../game/gameDAssets'
import { shoppingStats, shoppingProduct, SHOPPING_LEVELS, type GameDResult, type Shoppers } from '../game/gameD'
import { downloadJson } from '../game/logging'
import { playBgm, stopBgm } from '../game/bgm'
import './gameD.css'

export function GameDResultScreen({ result, shoppers, onReplay, onVillage, onTitle }: {
  result: GameDResult; shoppers: Shoppers; onReplay: () => void; onVillage: () => void; onTitle: () => void
}) {
  useEffect(() => { playBgm('report'); return () => stopBgm() }, [])
  const team = shoppingStats(result)
  return <div className="fill shopping-result" data-game="shopping-result">
    <img src={GAME_D_IMAGES.background} alt="" className="shopping-background" />
    <div className="shopping-result-content">
      <p className="shopping-eyebrow">협동 장보기 · {SHOPPING_LEVELS[result.level].label}</p>
      <h1>{result.reason === 'success' ? '함께 장보기를 마쳤어요!' : result.reason === 'timeout' ? '다음에는 모두 담아봐요!' : '여기까지 함께했어요'}</h1>
      <p className="shopping-result-summary">목록 {team.collected} / {team.required}개 · 정확도 {team.accuracy === null ? '—' : team.accuracy + '%'} · {Math.ceil(result.elapsedMs / 1000)}초</p>
      <div className="shopping-result-players">
        {([1, 2] as const).map(pid => {
          const stats = shoppingStats(result, pid)
          return <section key={pid} aria-label={pid + 'P 장보기 결과'}>
            <GameDShopper shopper={pid === 1 ? shoppers.p1 : shoppers.p2} pose="profile"
              style={{ position: 'relative', width: 150, height: 271, margin: '0 auto' }} />
            <h2>{pid === 1 ? '왼쪽' : '오른쪽'} 참가자</h2>
            <dl><div><dt>필요한 물건</dt><dd>{stats.correct}개</dd></div>
              <div><dt>잘못 담은 물건</dt><dd>{stats.wrong}개</dd></div>
              <div><dt>빈칸에서 동작</dt><dd>{stats.empty}회</dd></div>
              <div><dt>놓친 물건</dt><dd>{stats.missed}개</dd></div>
              <div><dt>평균 반응</dt><dd>{stats.reactionMs === null ? '—' : (stats.reactionMs / 1000).toFixed(1) + '초'}</dd></div>
              <div><dt>함께 담은 비율</dt><dd>{stats.contribution}%</dd></div>
            </dl>
          </section>
        })}
      </div>
      <ul className="shopping-result-list" aria-label="최종 쇼핑 목록">{result.targets.map(t =>
        <li key={t.product}><GameDArt name={t.product} /><span>{shoppingProduct(t.product).name}</span>
          <strong>{t.collected}/{t.required}</strong>{t.collected === t.required && <span aria-label="완료">✓</span>}</li>)}</ul>
      <div className="shopping-actions">
        <button className="pixel-btn" onClick={onReplay}>다시하기</button>
        <button className="pixel-btn secondary" onClick={onVillage}>마을로</button>
        <button className="pixel-btn secondary" onClick={onTitle}>홈으로</button>
      </div>
    </div>
    <GameTools><button className="pixel-btn secondary" onClick={() => downloadJson({ ...result, shoppers }, 'youngcha_gameD_' + Date.now() + '.json')}>기록 내려받기</button></GameTools>
  </div>
}
