import { playerGripEngine } from './playerGrip'
import type { PlayerId } from './types'

/** The active kneading player uses the same half-frame and tracker as the flag game. */
class RiceGripEngine {
  private player: PlayerId = 1
  get ready() { return playerGripEngine.ready }
  get error() { return playerGripEngine.error }
  init() { return playerGripEngine.init() }
  reset() { playerGripEngine.reset() }
  sample(player: PlayerId, now: number) {
    if (this.player !== player) { this.reset(); this.player = player }
    return playerGripEngine.sample(player, now).grip
  }
  status() {
    const state = playerGripEngine.status()
    return { ...state, ...state.players[this.player] }
  }
}
export const riceGripEngine = new RiceGripEngine()
