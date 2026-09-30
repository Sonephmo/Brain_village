import { SHOPPING_PRODUCTS, type ShoppingProductId } from './gameDCatalog'
import type { HandGrip } from './handGrip'
import type { PlayerId } from './types'

export type ShoppingLevel = 1 | 2 | 3
export type ShoppingGrip = HandGrip
export type Shoppers = { p1: 'male' | 'female'; p2: 'male' | 'female' }
export const GAME_D_RULES = {
  version: 'shopping-1', durationMs: 120000, gripHoldMs: 90, staleMs: 400,
  zoneStart: 844, zoneEnd: 1053, itemSize: 226, spacing: 280,
} as const
/** Adjustable pacing values; the time and acceptance rules were confirmed by the user. */
export const SHOPPING_LEVELS = {
  1: { label: '쉬움', types: 3, minQuantity: 2, maxQuantity: 3, speed: 85, decoyEvery: 4 },
  2: { label: '보통', types: 5, minQuantity: 2, maxQuantity: 4, speed: 100, decoyEvery: 3 },
  3: { label: '어려움', types: 7, minQuantity: 3, maxQuantity: 5, speed: 115, decoyEvery: 2 },
} as const
export interface ShoppingTarget { product: ShoppingProductId; required: number; collected: number }
export interface ShoppingItem { id: number; player: PlayerId; product: ShoppingProductId; y: number; enteredAt: number | null; missed: boolean }
export interface ShoppingEvent {
  player: PlayerId; itemId: number | null; product: ShoppingProductId | null; atMs: number
  outcome: 'correct' | 'wrong' | 'empty' | 'missed'
  reason?: 'not-listed' | 'already-complete'
  reactionMs: number | null
}
export interface GameDResult {
  game: '협동 장보기'; rulesVersion: string; level: ShoppingLevel; startedAt: string
  durationMs: number; elapsedMs: number; reason: 'success' | 'timeout' | 'aborted'
  targets: ShoppingTarget[]; events: ShoppingEvent[]; inputModes: ('camera' | 'keyboard')[]
}

export function shoppingProduct(id: ShoppingProductId) {
  return SHOPPING_PRODUCTS.find(p => p.id === id)!
}
export function availableFor(product: ShoppingProductId, player: PlayerId) {
  const side = shoppingProduct(product).side
  return side === 'both' || side === (player === 1 ? 'left' : 'right')
}
export function createShoppingList(level: ShoppingLevel, random = Math.random): ShoppingTarget[] {
  const take = (side: 'left' | 'right' | 'both', count: number) => {
    const pool = SHOPPING_PRODUCTS.filter(p => p.side === side)
    const chosen: ShoppingProductId[] = []
    for (let i = 0; i < count; i++) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0].id)
    return chosen
  }
  const config = SHOPPING_LEVELS[level]
  return [...take('left', 1), ...take('right', 1), ...take('both', config.types - 2)].map(product => ({
    product, required: config.minQuantity + Math.floor(random() * (config.maxQuantity - config.minQuantity + 1)), collected: 0,
  }))
}

/** Requires a fresh open pose before each closure. Tracking loss never completes a gesture. */
export class ShoppingGripTracker {
  private armed = false
  private candidate: ShoppingGrip = 'unknown'
  private since = 0
  reset() { this.armed = false; this.candidate = 'unknown'; this.since = 0 }
  update(grip: ShoppingGrip, at: number): boolean {
    if (grip === 'unknown') { this.reset(); return false }
    if (grip !== this.candidate) { this.candidate = grip; this.since = at }
    if (at - this.since < GAME_D_RULES.gripHoldMs) return false
    if (grip === 'open') this.armed = true
    if (grip === 'closed' && this.armed) { this.armed = false; return true }
    return false
  }
}

export class ShoppingSession {
  readonly targets: ShoppingTarget[]
  readonly events: ShoppingEvent[] = []
  items: ShoppingItem[] = []
  elapsedMs = 0
  reason: GameDResult['reason'] | null = null
  readonly startedAt: string
  private serial = 0
  private nextSpawn = 0
  private turns: Record<PlayerId, number> = { 1: 0, 2: 0 }
  private modes = new Set<'camera' | 'keyboard'>()
  constructor(readonly level: ShoppingLevel, private random = Math.random, targets?: ShoppingTarget[]) {
    this.targets = (targets ?? createShoppingList(level, random)).map(t => ({ ...t, collected: 0 }))
    this.startedAt = new Date().toISOString()
    // Ready-to-pick items avoid a long, empty wait after the countdown.
    for (let n = 0; n < 4; n++) for (const pid of [1, 2] as const) this.spawn(pid, 940 - n * GAME_D_RULES.spacing)
    this.nextSpawn = GAME_D_RULES.spacing / SHOPPING_LEVELS[level].speed * 1000
  }
  noteMode(mode: 'camera' | 'keyboard') { this.modes.add(mode) }
  private spawn(player: PlayerId, y: number) {
    const needed = this.targets.filter(t => t.collected < t.required && availableFor(t.product, player))
    const pool = SHOPPING_PRODUCTS.filter(p => availableFor(p.id, player))
    const turn = this.turns[player]++
    const decoy = turn > 0 && turn % SHOPPING_LEVELS[this.level].decoyEvery === 0
    // Prefer underrepresented outstanding targets, so random decoys cannot starve the list.
    const ranked = needed.map(t => ({ target: t, pending: this.items.filter(i =>
      i.product === t.product && !i.missed).length / (t.required - t.collected) }))
    ranked.sort((a, b) => a.pending - b.pending)
    const eligible = ranked.filter(r => r.pending === ranked[0]?.pending)
    const product = !decoy && eligible.length
      ? eligible[Math.floor(this.random() * eligible.length)].target.product
      : pool[Math.floor(this.random() * pool.length)].id
    this.items.push({ id: ++this.serial, player, product, y, enteredAt: y >= GAME_D_RULES.zoneStart ? this.elapsedMs : null, missed: false })
  }
  advance(ms: number) {
    if (this.reason || !Number.isFinite(ms) || ms <= 0) return
    const end = Math.min(GAME_D_RULES.durationMs, this.elapsedMs + ms)
    // Integrate at spawn boundaries, making the simulation independent of render frame rate.
    while (this.elapsedMs < end) {
      const next = Math.min(end, this.nextSpawn)
      const dt = next - this.elapsedMs
      const speed = SHOPPING_LEVELS[this.level].speed
      for (const item of this.items) {
        const from = item.y
        item.y += speed * dt / 1000
        if (item.enteredAt === null && item.y >= GAME_D_RULES.zoneStart)
          item.enteredAt = this.elapsedMs + Math.max(0, (GAME_D_RULES.zoneStart - from) / speed * 1000)
        if (!item.missed && item.y > GAME_D_RULES.zoneEnd) {
          item.missed = true
          const target = this.targets.find(t => t.product === item.product)
          if (target && target.collected < target.required) this.events.push({
            player: item.player, itemId: item.id, product: item.product,
            atMs: Math.round(this.elapsedMs + Math.max(0, (GAME_D_RULES.zoneEnd - from) / speed * 1000)),
            outcome: 'missed', reactionMs: null,
          })
        }
      }
      this.elapsedMs = next
      this.items = this.items.filter(i => i.y < 1250)
      if (next >= this.nextSpawn) {
        for (const pid of [1, 2] as const) this.spawn(pid, 100)
        this.nextSpawn += GAME_D_RULES.spacing / speed * 1000
      }
    }
    if (this.elapsedMs >= GAME_D_RULES.durationMs) this.reason = 'timeout'
  }
  pick(player: PlayerId): ShoppingEvent | null {
    if (this.reason) return null
    const item = this.items.find(i => i.player === player && i.y >= GAME_D_RULES.zoneStart && i.y <= GAME_D_RULES.zoneEnd)
    let event: ShoppingEvent
    if (!item) event = { player, itemId: null, product: null, atMs: Math.round(this.elapsedMs), outcome: 'empty', reactionMs: null }
    else {
      const target = this.targets.find(t => t.product === item.product)
      const correct = !!target && target.collected < target.required
      if (correct) target.collected++
      event = { player, itemId: item.id, product: item.product, atMs: Math.round(this.elapsedMs),
        outcome: correct ? 'correct' : 'wrong',
        ...(!correct ? { reason: target ? 'already-complete' as const : 'not-listed' as const } : {}),
        reactionMs: Math.round(this.elapsedMs - (item.enteredAt ?? this.elapsedMs)) }
      this.items = this.items.filter(i => i.id !== item.id)
    }
    this.events.push(event)
    if (this.targets.every(t => t.collected === t.required)) this.reason = 'success'
    return event
  }
  finish(reason: GameDResult['reason'] = 'aborted'): GameDResult {
    this.reason ??= reason
    return {
      game: '협동 장보기', rulesVersion: GAME_D_RULES.version, level: this.level,
      startedAt: this.startedAt, durationMs: GAME_D_RULES.durationMs, elapsedMs: Math.round(this.elapsedMs),
      reason: this.reason, targets: this.targets.map(t => ({ ...t })), events: this.events.map(e => ({ ...e })),
      inputModes: [...this.modes],
    }
  }
}
export function shoppingStats(result: GameDResult, player?: PlayerId) {
  const events = result.events.filter(e => player === undefined || e.player === player)
  const correct = events.filter(e => e.outcome === 'correct').length
  const wrong = events.filter(e => e.outcome === 'wrong').length
  const empty = events.filter(e => e.outcome === 'empty').length
  const missed = events.filter(e => e.outcome === 'missed').length
  const attempts = correct + wrong + empty
  const reactions = events.filter(e => e.outcome === 'correct' && e.reactionMs !== null).map(e => e.reactionMs!)
  const teamCorrect = result.events.filter(e => e.outcome === 'correct').length
  const p1Correct = result.events.filter(e => e.outcome === 'correct' && e.player === 1).length
  const contribution = !teamCorrect ? 0 : player === 2
    ? 100 - Math.round(p1Correct / teamCorrect * 100) : Math.round(correct / teamCorrect * 100)
  return { correct, wrong, empty, missed, attempts,
    accuracy: attempts ? Math.round(correct / attempts * 100) : null,
    reactionMs: reactions.length ? Math.round(reactions.reduce((a, b) => a + b, 0) / reactions.length) : null,
    contribution,
    collected: result.targets.reduce((sum, t) => sum + t.collected, 0),
    required: result.targets.reduce((sum, t) => sum + t.required, 0),
  }
}
