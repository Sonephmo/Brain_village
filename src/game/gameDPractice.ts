import { GAME_D_RULES, type ShoppingItem, type ShoppingTarget } from './gameD'
import type { PlayerId } from './types'

/** An unscored conveyor rehearsal: each lane waits for its own participant. */
export class ShoppingPractice {
  elapsedMs = 0
  collected: Record<PlayerId, number> = { 1: 0, 2: 0 }
  targets: ShoppingTarget[] = [{ product: 'apple', required: 4, collected: 0 }]
  items: ShoppingItem[] = ([1, 2] as const).flatMap(player => [0, 1].map(n => ({
    id: player * 10 + n, player, product: 'apple' as const, y: 940 - n * 480,
    enteredAt: n === 0 ? 0 : null, missed: false,
  })))
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return
    this.elapsedMs += ms
    for (const player of [1, 2] as const) {
      const lane = this.items.filter(item => item.player === player)
      const leading = Math.max(...lane.map(item => item.y))
      const distance = Math.max(0, Math.min(ms * .16, 940 - leading))
      lane.forEach(item => { item.y += distance })
    }
  }
  pick(player: PlayerId): ShoppingItem | null {
    const item = this.items.find(item => item.player === player &&
      item.y >= GAME_D_RULES.zoneStart && item.y <= GAME_D_RULES.zoneEnd)
    if (!item) return null
    this.items = this.items.filter(candidate => candidate !== item)
    this.collected[player]++
    this.targets[0].collected++
    return item
  }
}
