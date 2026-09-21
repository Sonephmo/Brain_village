import { GAME_C_IMAGES } from '../game/gameCAssets'
import type { RiceFeedback } from '../game/gameC'

// Figma's four cropped frames, in playback order, anchored to the rice cake.
// [x, y, width, height, source width %, source left %, source top %]
const FRAMES = {
  star: [
    [814, 369, 238, 297, 375.13, .03, 0],
    [794, 369, 238, 297, 375.13, -87.53, 0],
    [807, 360, 238, 297, 375.13, -180.21, 0],
    [802, 353, 238, 297, 375.13, -275.13, 0],
  ],
  mix: [
    [855, 485, 210, 362, 515.91, .02, 0],
    [807, 485, 293, 362, 371.28, -68.12, 0],
    [816, 485, 292, 362, 371.28, -166.65, -.01],
    [816, 485, 293, 362, 371.28, -271.28, 0],
  ],
} as const

export function GameCEffect({ kind }: { kind: RiceFeedback }) {
  const src = kind === 'star' ? GAME_C_IMAGES.poundFeedback : GAME_C_IMAGES.mixFeedback
  return <div className="game-c-effect" data-effect={kind} aria-hidden="true">
    {FRAMES[kind].map(([left, top, width, height, sourceWidth, cropLeft, cropTop], index) =>
      <div key={index} style={{ left, top, width, height, animationDelay: `${index * 150}ms` }}>
        <img src={src} alt="" style={{ width: `${sourceWidth}%`, left: `${cropLeft}%`, top: `${cropTop}%` }} />
      </div>)}
  </div>
}
