import type { PlayerId } from './types'

export type RiceAction = 'pound' | 'left' | 'right' | 'squeeze'
export type RiceFeedback = 'star' | 'mix'
export type Rabbit = 'pink' | 'brown'
export type Rabbits = { p1: Rabbit; p2: Rabbit }
export interface RiceBody {
  tracked: boolean
  left: boolean
  right: boolean
  aboveHead: boolean
}
export type Grip = 'open' | 'closed' | 'unknown'
export interface RiceInput extends RiceBody { grip: Grip }
export const GAME_C_RULES = {
  version: 'flow-2', responseMs: 3000, feedbackMs: 1000,
  swapMs: 4000, holdMs: 120, finishHoldMs: 1000,
  points: 5, passScore: 50, maxScore: 100,
} as const
export const RICE_GUIDES: Record<RiceAction, { title: string; speech: string; guide: string }> = {
  pound: { title: '방아찧기', speech: '떡방아를\n찧어주세요', guide: '떡메를 든 사람이 양손을\n들었다 내려주세요' },
  squeeze: { title: '떡 주무르기', speech: '양손을 세 번\n주물러주세요', guide: '맨손인 사람이 양손을\n오므렸다 펴는 동작을 세 번 해주세요' },
  left: { title: '떡 뒤집기', speech: '떡을 왼쪽으로\n뒤집어주세요', guide: '맨손인 사람이\n왼손을 들어주세요' },
  right: { title: '떡 뒤집기', speech: '떡을 오른쪽으로\n뒤집어주세요', guide: '맨손인 사람이\n오른손을 들어주세요' },
}
export interface RiceCue { action: RiceAction; player: PlayerId; round: 1 | 2 }
const actions: RiceAction[] = ['pound', 'squeeze', 'pound', 'left', 'pound', 'right', 'pound', 'squeeze', 'pound', 'left']
export const RICE_CUES: RiceCue[] = ([1, 2] as const).flatMap(round =>
  actions.map(action => ({ action, round, player: (action === 'pound' ? round : 3 - round) as PlayerId })),
)
export const RICE_CUE_MS = GAME_C_RULES.responseMs + GAME_C_RULES.feedbackMs
export const RICE_TOTAL_MS = RICE_CUES.length * RICE_CUE_MS
export const RICE_PRACTICE: RiceCue[] = [
  { action: 'pound', player: 1, round: 1 }, { action: 'squeeze', player: 2, round: 1 },
  { action: 'pound', player: 1, round: 1 }, { action: 'right', player: 2, round: 1 },
  { action: 'left', player: 2, round: 1 }, { action: 'pound', player: 2, round: 2 },
  { action: 'squeeze', player: 1, round: 2 },
]
export interface RiceTrial extends RiceCue {
  outcome: 'correct' | 'wrong' | 'missed'
  reactionMs: number | null
  completionMs: number | null
}
export interface GameCResult {
  game: '쿵떡쿵떡 떡방아'
  rulesVersion: string
  score: number
  completed: boolean
  finishPoseCompleted: boolean
  startedAt: string
  trials: RiceTrial[]
}
export const freshRiceResult = (): GameCResult => ({
  game: '쿵떡쿵떡 떡방아', rulesVersion: GAME_C_RULES.version, score: 0,
  completed: false, finishPoseCompleted: false, startedAt: '', trials: [],
})

/** Counts complete movements only. Unknown tracking breaks a partial cycle. */
export class RiceActionTracker {
  count = 0
  complete = false
  movementAt: number | null = null
  reactionMs: number | null = null
  completionMs: number | null = null
  private phase: 'waiting' | 'ready' | 'active' = 'waiting'
  private candidate = ''
  private since = 0
  private moved = false
  private started = 0
  constructor(readonly action: RiceAction, readonly openedAt: number) {}

  /** Emits once per accepted movement, including each of the three kneading cycles. */
  update(input: RiceInput, now: number): RiceFeedback | undefined {
    if (this.complete) return
    if (!input.tracked || (this.action === 'squeeze' && input.grip === 'unknown')) {
      this.phase = 'waiting'
      this.candidate = ''
      return
    }
    const neutral = this.action === 'squeeze' ? input.grip === 'open' : !input.left && !input.right
    const active = this.action === 'squeeze' ? input.grip === 'closed'
      : this.action === 'pound' ? input.left && input.right
      : this.action === 'left' ? input.left && !input.right : input.right && !input.left
    const state = neutral ? 'neutral' : active ? 'active' : 'other'
    if (state !== this.candidate) { this.candidate = state; this.since = now }
    if (state !== 'neutral') this.moved = true
    if (now - this.since < GAME_C_RULES.holdMs) return
    if (this.phase === 'waiting') {
      if (neutral) this.phase = 'ready'
      return
    }
    if (this.phase === 'ready' && active) {
      this.phase = 'active'
      this.movementAt = now
      this.started = this.since
      if (this.reactionMs == null) this.reactionMs = Math.round(this.started - this.openedAt)
      if (this.action === 'left' || this.action === 'right') {
        this.finish(now)
        return 'mix'
      }
    } else if (this.phase === 'active' && neutral) {
      this.count++
      this.movementAt = now
      this.phase = 'ready'
      if (this.count >= (this.action === 'squeeze' ? 3 : 1)) this.finish(now)
      return this.action === 'pound' ? 'star' : 'mix'
    }
  }
  private finish(now: number) { this.complete = true; this.completionMs = Math.round(now - this.openedAt) }
  result(cue: RiceCue): RiceTrial {
    return { ...cue, outcome: this.complete ? 'correct' : this.moved ? 'wrong' : 'missed',
      reactionMs: this.complete ? this.reactionMs : null, completionMs: this.completionMs }
  }
}

export interface RiceMotionFrame {
  dough: 1 | 2 | 3 | 4
  assistPose: 'idle' | 'squeeze-1' | 'squeeze-2'
}
export const RICE_MOTION_REST: RiceMotionFrame = { dough: 4, assistPose: 'idle' }
export const RICE_MOTION_TIMING = { frameMs: 150, strikeMs: 300, assistMs: 750 } as const

/** Displayed mallet position is independent of whether a full strike was accepted. */
export function ricePoundPose(input: RiceBody): 'up' | 'down' {
  return input.tracked && input.left && input.right ? 'up' : 'down'
}

/** Visual feedback never awards points or advances the movement tracker. */
export class RiceMotion {
  private kind: 'strike' | 'assist' | null = null
  private startedAt = 0
  private until = 0

  reset() { this.kind = null; this.until = 0 }

  strike(now: number) {
    this.kind = 'strike'
    this.startedAt = now
    this.until = now + RICE_MOTION_TIMING.strikeMs
  }

  assist(now: number) {
    // Continued kneading extends the loop without snapping back to its first frame.
    if (this.kind !== 'assist' || now >= this.until) this.startedAt = now
    this.kind = 'assist'
    this.until = now + RICE_MOTION_TIMING.assistMs
  }

  sample(now: number, reducedMotion = false): RiceMotionFrame {
    if (!this.kind || now >= this.until || reducedMotion) return RICE_MOTION_REST
    if (this.kind === 'strike') return { dough: 1, assistPose: 'idle' }
    const frame = Math.floor((now - this.startedAt) / RICE_MOTION_TIMING.frameMs)
    // Loop 02 → 04 → 03 → 04 → 02 ... using the actual named assets, without mirroring.
    return { dough: ([2, 4, 3, 4] as const)[frame % 4], assistPose: frame % 2 === 0 ? 'squeeze-1' : 'squeeze-2' }
  }
}

export class RiceFinishTracker {
  private armed = [false, false]
  private raisedSince: number | null = null
  update(inputs: readonly [RiceBody, RiceBody], now: number) {
    inputs.forEach((input, index) => {
      if (input.tracked && !input.left && !input.right) this.armed[index] = true
    })
    const both = this.armed.every(Boolean) && inputs.every(input => input.tracked && input.aboveHead)
    if (!both) this.raisedSince = null
    else if (this.raisedSince === null) this.raisedSince = now
    return this.raisedSince === null ? 0 : Math.min(1, (now - this.raisedSince) / GAME_C_RULES.finishHoldMs)
  }
}

export function ricePlayerStats(result: GameCResult, player: PlayerId) {
  const trials = result.trials.filter(t => t.player === player)
  const correct = trials.filter(t => t.outcome === 'correct').length
  const wrong = trials.filter(t => t.outcome === 'wrong').length
  const missed = trials.filter(t => t.outcome === 'missed').length
  // Each player has 10 scheduled actions. An aborted run never gets a full rating.
  const rating = Math.floor(correct / 2)
  const score = correct * GAME_C_RULES.points
  const maxScore = RICE_CUES.filter(cue => cue.player === player).length * GAME_C_RULES.points
  return { total: trials.length, correct, wrong, missed, rating, score, maxScore }
}
