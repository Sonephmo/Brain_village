import type { Avatar } from '../assets'
import { GAME_B_CHARACTERS } from '../game/gameBAssets'

/** Keep all poses on their original 1200 × 900 canvas so the feet stay anchored. */
export function GameBAvatar({ avatar, pose, width, left, top }: {
  avatar: Avatar; pose: 'up' | 'down' | 'stand' | 'tutorial'
  width: number; left: number; top: number
}) {
  const images = GAME_B_CHARACTERS[avatar]
  return <div data-game-b-avatar={avatar} data-pose={pose} style={{ position: 'absolute', left: left - width / 2, top, width, height: width * .75, pointerEvents: 'none' }}>
    <img src={images[pose]} alt="" className="fill" />
    {(pose === 'down' || (avatar === 'grandma' && pose === 'up')) && <img src={images.tutorial} alt="" className="fill"
      style={{ clipPath: `ellipse(10.5% 11.5% at ${avatar === 'grandma' ? 51 : 48.5}% 35%)` }} />}
  </div>
}
