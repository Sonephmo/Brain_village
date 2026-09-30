import type { CSSProperties } from 'react'
import { Sprite } from './Sprite'
import { shopperFrame, type Shopper, type ShopperPose } from '../game/gameDAssets'

export function GameDShopper({ shopper, pose = 'open', mirror = false, style }: {
  shopper: Shopper; pose?: ShopperPose; mirror?: boolean; style?: CSSProperties
}) {
  const frame = shopperFrame(shopper, pose)
  return <Sprite frame={frame} style={{ width: 600, height: frame.rect[3],
    transform: mirror ? 'scaleX(-1)' : undefined, ...style }} />
}
