import type { CSSProperties } from 'react'
import type { Rabbit } from '../game/gameC'
import { GAME_C_IMAGES, rabbitSrc, type RabbitPose } from '../game/gameCAssets'

/** Figma's original transparent images keep their 1200 × 900 canvas. */
export function GameCRabbit({ rabbit, pose = 'idle', side = 1, style }: {
  rabbit: Rabbit; pose?: RabbitPose; side?: 1 | 2; style?: CSSProperties
}) {
  return <img alt="" src={rabbitSrc(rabbit, pose)} className="game-c-rabbit" data-rabbit={rabbit} data-pose={pose}
    style={{ left: side === 1 ? 398 : 768, top: 306, width: 680, height: 510,
      transform: side === 2 ? 'scaleX(-1)' : undefined, ...style }} />
}

/** Figma crop percentages, applied to the exact source sheet without editing it. */
export function RabbitPortrait({ rabbit, style }: { rabbit: Rabbit; style?: CSSProperties }) {
  return <div className="game-c-portrait" style={style}>
    <img alt={rabbit === 'pink' ? '분홍 토끼' : '갈색 토끼'} src={GAME_C_IMAGES.select}
      style={{ position: 'absolute', width: '253.05%', height: '100.04%', top: '-0.04%',
        left: rabbit === 'pink' ? '-29.98%' : '-119.7%', maxWidth: 'none' }} />
  </div>
}

export function RiceCake({ style }: { style?: CSSProperties }) {
  return <div className="game-c-cake" style={style}><img alt="완성한 떡" src={GAME_C_IMAGES.cakes}
    style={{ position: 'absolute', width: '304.83%', height: '249.39%', left: '-4.19%', top: '-14.25%', maxWidth: 'none' }} /></div>
}
