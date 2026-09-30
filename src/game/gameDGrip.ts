import { playerGripEngine } from './playerGrip'
import type { ShoppingGrip } from './gameD'
import type { PlayerId } from './types'

/** Each participant gets a separate half-frame and two-hand model, as in the flag game. */
class ShoppingGripEngine {
  get ready() { return playerGripEngine.ready }
  get error() { return playerGripEngine.error }
  init() { return playerGripEngine.init() }
  reset() { playerGripEngine.reset() }
  sample(now: number): { grips: Record<PlayerId, ShoppingGrip>; at: number } {
    const p1 = playerGripEngine.sample(1, now), p2 = playerGripEngine.sample(2, now)
    // Return a new object: a screen's body-presence gate must not alter cached hand results.
    return { grips: { 1: p1.grip, 2: p2.grip }, at: Math.min(p1.at, p2.at) }
  }
  status() {
    const state = playerGripEngine.status(), p1 = state.players[1], p2 = state.players[2]
    return { ...state, hands: p1.hands + p2.hands, grips: { 1: p1.grip, 2: p2.grip }, at: Math.min(p1.at, p2.at) }
  }
}
export const shoppingGripEngine = new ShoppingGripEngine()
