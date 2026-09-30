import type { CSSProperties } from 'react'
import { Sprite } from './Sprite'
import { shoppingArtFrame, type ShoppingArt } from '../game/gameDAssets'

/** Uses Figma's source alpha and authored crop without baking in the asset-board background. */
export function GameDArt({ name, alt = '', className = '', style }: {
  name: ShoppingArt; alt?: string; className?: string; style?: CSSProperties
}) {
  return <div className={'shopping-art ' + className} role={alt ? 'img' : undefined}
    aria-label={alt || undefined} aria-hidden={alt ? undefined : true} style={style}>
    <Sprite frame={shoppingArtFrame(name)} style={{ inset: 0, width: '100%', height: '100%' }} />
  </div>
}
