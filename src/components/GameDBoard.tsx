import type { CSSProperties } from 'react'
import { GameDArt } from './GameDArt'
import { GameDShopper } from './GameDShopper'
import { GameTimer } from './GameTimer'
import { Sprite } from './Sprite'
import { FX } from '../assets'
import { GAME_D_IMAGES } from '../game/gameDAssets'
import { GAME_D_RULES, SHOPPING_LEVELS, shoppingProduct, type ShoppingEvent, type ShoppingGrip,
  type ShoppingItem, type ShoppingTarget, type ShoppingLevel, type Shoppers } from '../game/gameD'
import type { PlayerId } from '../game/types'

export type ShoppingFeedback = ShoppingEvent & { id: number; until: number; fromY: number }

/** The same scene renders both the guided rehearsal and the scored game. */
export function GameDBoard({ current, level, remaining, shoppers, grips, feedback, keyboard, practice, tracking = false }: {
  current: { elapsedMs: number; items: ShoppingItem[]; targets: ShoppingTarget[] } | null
  level: ShoppingLevel; remaining: number; shoppers: Shoppers
  grips: Record<PlayerId, ShoppingGrip>; feedback: ShoppingFeedback[]; keyboard: boolean
  practice?: Record<PlayerId, number>; tracking?: boolean
}) {
  return <div className="shopping-board" data-practice={!!practice}>
    <img src={GAME_D_IMAGES.background} alt="" className="shopping-background" />
      {([1, 2] as const).map(pid => <div className="shopping-lane" key={pid} style={{ left: pid === 1 ? 0 : 1560 }} aria-label={pid === 1 ? '왼쪽 컨베이어' : '오른쪽 컨베이어'}>
        <GameDArt name="conveyor" className="shopping-conveyor" />
        {[0, 1, 2, 3, 4].map(i => <GameDArt key={i} name="belt" className="shopping-belt"
          style={{ top: i * 280 - 276 + ((current?.elapsedMs ?? 0) * SHOPPING_LEVELS[level].speed / 1000 % 280) }} />)}
        {(current?.items ?? []).filter(i => i.player === pid).map(item =>
          <div className="shopping-item" key={item.id} data-item-id={item.id} data-player={pid} data-product={item.product}
            data-pickable={item.y >= GAME_D_RULES.zoneStart && item.y <= GAME_D_RULES.zoneEnd}
            style={{ transform: 'translateY(' + (item.y - 113) + 'px)' }}>
            <GameDArt name={item.product} alt={shoppingProduct(item.product).name} />
            <span>{shoppingProduct(item.product).name}</span>
          </div>)}
        <div className="shopping-pick-zone" aria-label={pid === 1 ? '왼쪽 담기 영역' : '오른쪽 담기 영역'} />
      </div>)}
      {!practice && <GameTimer value={remaining} />}
      <div className="shopping-instruction"><p>{practice ? <>사과를 두 개씩<br />담아 보세요</> : <>목록을 보고<br />함께 담아요</>}</p><span>초록 칸에서 양손 잼잼!</span></div>
      <div className="shopping-progress">{practice ? '연습 바구니' : SHOPPING_LEVELS[level].label}<br />{current?.targets.reduce((s, t) => s + t.collected, 0) ?? 0} / {current?.targets.reduce((s, t) => s + t.required, 0) ?? '—'}개</div>
      <section className="shopping-list" aria-label="공동 쇼핑 목록">
        <GameDArt name="list" className="shopping-list-art" />
        <h2>쇼핑 목록</h2>
        <ul className={level === 3 ? 'compact' : ''}>{current?.targets.map(target =>
          <li key={target.product} className={target.collected === target.required ? 'complete' : ''}
            aria-label={shoppingProduct(target.product).name + ' ' + target.collected + ' / ' + target.required + '개'}>
            <GameDArt name={target.product} /><span>{shoppingProduct(target.product).name}</span>
            <strong>{target.collected}/{target.required}</strong>
            {target.collected === target.required && <><span className="shopping-complete" aria-label="완료">✓</span><img className="shopping-mark" src={GAME_D_IMAGES.completeMark} alt="" /></>}
          </li>)}</ul>
      </section>
      <GameDArt name="basket-back" className="shopping-basket" alt="공동 장바구니" />
      <div className="shopping-basket-items">{current?.targets.flatMap(t =>
        Array.from({ length: Math.min(practice ? 4 : 2, t.collected) }, (_, i) =>
          <GameDArt key={t.product + i} name={t.product} />))}</div>
      {([1, 2] as const).map(pid => <div key={pid} className="shopping-person" style={{ left: pid === 1 ? 359 : 1181 }}>
        <GameDShopper shopper={pid === 1 ? shoppers.p1 : shoppers.p2} mirror={pid === 1}
          pose={grips[pid] === 'closed' ? 'closed' : grips[pid] === 'closing' ? 'closing' : 'open'}
          style={{ width: 380, height: 459, left: 0, top: 0 }} />
        {practice && <div className="shopping-rehearsal-progress" role="status" aria-label={`${pid === 1 ? '왼쪽' : '오른쪽'} 참가자 ${practice[pid]} / 2회`}>
          {practice[pid] >= 2 && <Sprite frame={FX.good} style={{ position: 'relative', width: 150, height: 84 }} />}
          <span>{practice[pid]} / 2</span>
        </div>}
        <p className="shopping-player-label">{pid === 1 ? '왼쪽' : '오른쪽'} 참가자</p>
        {!keyboard && grips[pid] === 'unknown' && tracking && <p className="shopping-tracking">두 손을 보여 주세요</p>}
      </div>)}
      {feedback.filter(f => f.outcome === 'correct' && f.product).map(f => <GameDArt key={f.id} className="shopping-fly"
        name={f.product!} style={{ left: f.player === 1 ? 69 : 1629, top: f.fromY,
          '--dx': (905 - (f.player === 1 ? 69 : 1629)) + 'px', '--dy': (899 - f.fromY) + 'px',
        } as CSSProperties} />)}
      {([1, 2] as const).map(pid => {
        const f = feedback.filter(f => f.player === pid).slice(-1)[0]
        return f ? <p key={pid} role="status" className={'shopping-feedback ' + (f.outcome === 'correct' ? 'good' : '')}
          style={{ left: pid === 1 ? 375 : 1200 }}>{f.outcome === 'correct' ? '잘 담았어요!' : f.outcome === 'empty' ? '초록 칸에 오면 담아요' : f.reason === 'already-complete' ? '이미 다 담았어요' : '목록에 없는 물건이에요'}</p> : null
      })}
  </div>
}
