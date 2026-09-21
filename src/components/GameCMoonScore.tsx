import { GAME_C_IMAGES } from '../game/gameCAssets'
import type { PlayerId } from '../game/types'

/** Each moon holds one fifth of the player's score, including partial fills. */
export function GameCMoonScore({ player, score, maxScore }: {
  player: PlayerId; score: number; maxScore: number
}) {
  const progress = maxScore > 0 ? Math.min(1, Math.max(0, score / maxScore)) : 0
  return <div className={`game-c-score player-${player}`} role="progressbar"
    aria-label={`${player}P 점수`} aria-valuemin={0} aria-valuemax={maxScore} aria-valuenow={score}
    aria-valuetext={`${maxScore}점 중 ${score}점`}>
    <span className="game-c-score-player" aria-hidden="true">{player}P</span>
    <div className="game-c-moons" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.min(1, Math.max(0, progress * 5 - index))
        return <div key={index} className="game-c-moon">
          <img alt="" src={GAME_C_IMAGES.moon} className="game-c-moon-empty" />
          <div className="game-c-moon-fill" style={{ clipPath: `inset(${(1 - fill) * 100}% 0 0)` }}>
            <img alt="" src={GAME_C_IMAGES.moon} />
          </div>
        </div>
      })}
    </div>
  </div>
}
