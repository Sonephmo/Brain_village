import { BASE, FX, IMG, type Frame } from '../assets'
import shopperFrames from '../../public/assets/game-d/characters/frames-active.json'
import artFrames from '../../public/assets/game-d/art-frames.json'

/** Figma exports retain their authored crops; character PNGs retain generated alpha. */
export const gameDAsset = (name: string) => `${BASE}assets/game-d/${name}.png`
export type Shopper = 'male' | 'female'
export type ShopperPose = 'profile' | 'open' | 'closing' | 'closed'
/** Side poses share one generated sheet per person; crop origins align the feet. */
export function shopperFrame(shopper: Shopper, pose: ShopperPose): Frame {
  const frame = shopperFrames.characters[shopper][pose]
  return {
    src: `${BASE}assets/game-d/characters/${frame.file}`,
    sheet: frame.sheet as [number, number],
    rect: frame.rect as [number, number, number, number],
  }
}

export { SHOPPING_PRODUCTS, type ShoppingProductId } from './gameDCatalog'

export const GAME_D_IMAGES = {
  background: gameDAsset('background'), completeMark: gameDAsset('source/complete-mark'),
}
export type ShoppingArt = keyof typeof artFrames.frames
export function shoppingArtFrame(name: ShoppingArt): Frame {
  const frame = artFrames.frames[name]
  return { src: `${BASE}assets/game-d/${frame.file}`, sheet: frame.sheet as [number, number],
    rect: frame.rect as [number, number, number, number] }
}
export const GAME_D_ART = Object.fromEntries(Object.keys(artFrames.frames).map(name =>
  [name, shoppingArtFrame(name as ShoppingArt)]))

export async function preloadGameD() {
  const files = new Set([
    IMG.tutBg, IMG.count3, IMG.count2, IMG.count1, IMG.countStart, FX.good.src,
    ...Object.values(GAME_D_IMAGES), ...Object.values(GAME_D_ART).map(frame => frame.src),
    ...(['male', 'female'] as const).flatMap(s =>
      (['profile', 'open', 'closing', 'closed'] as const).map(p => shopperFrame(s, p).src)),
  ])
  await Promise.all([...files].map(src => new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(src))
    image.src = src
  })))
}
