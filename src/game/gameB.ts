/** 디자인 검토용 임시 규칙. 최종 채점/이벤트 규칙 확정 전에는 서버 전송하지 않는다. */
export const GAME_B_RULES = {
  durationMs: 60_000,
  eventMs: 6_000,
  practiceWaves: 5,
  eventWaves: 2,
  holdMs: 150,
  stillMs: 2_000,
  frameMs: 140,
  pointsPerEvent: 10,
} as const
export type FireTask = 'stand' | 'left' | 'right' | 'big'
export const GAME_B_EVENTS: FireTask[] = ['stand', 'left', 'right', 'big', 'stand', 'right', 'left', 'big', 'stand', 'big']
export const FIRE_GUIDES: Record<FireTask, { title: string; guide: string }> = {
  stand: { title: '부채질', guide: '두사람 모두 양손을 위 아래로 5번 흔들어주세요' },
  left: { title: '불이 왼쪽으로 기울어요!', guide: '왼쪽 사람만 팔을 다섯 번 흔들어주세요' },
  right: { title: '불이 오른쪽으로 기울어요!', guide: '오른쪽 사람만 팔을 다섯 번 흔들어주세요' },
  big: { title: '도깨비불이 나타났어요!', guide: '두사람 모두 동작을 멈춰주세요' },
}
export interface FanPose {
  present: boolean
  leftRaised: boolean
  rightRaised: boolean
  leftWristY: number | null
  rightWristY: number | null
}

/** 양손 내려놓기 → 양손 올리기 → 양손 내려놓기의 완전한 왕복만 1회. */
export class FanCounter {
  count = 0
  stillSince: number | null = null
  private candidate = ''
  private since = 0
  private phase: 'waiting' | 'down' | 'up' = 'waiting'
  private previous: FanPose | null = null

  update(pose: FanPose, now: number) {
    if (!pose.present) {
      this.candidate = ''
      this.phase = 'waiting'
      this.stillSince = null
      this.previous = null
      return
    }
    const before = this.previous
    const moved = !before || before.leftRaised !== pose.leftRaised || before.rightRaised !== pose.rightRaised ||
      (before.leftWristY != null && pose.leftWristY != null && Math.abs(before.leftWristY - pose.leftWristY) > 0.018) ||
      (before.rightWristY != null && pose.rightWristY != null && Math.abs(before.rightWristY - pose.rightWristY) > 0.018)
    if (moved || this.stillSince == null) this.stillSince = now
    if (moved) this.previous = { ...pose }
    const next = pose.leftRaised && pose.rightRaised ? 'up' : !pose.leftRaised && !pose.rightRaised ? 'down' : 'mixed'
    if (next !== this.candidate) { this.candidate = next; this.since = now }
    if (now - this.since < GAME_B_RULES.holdMs) return
    if (next === 'down') {
      if (this.phase === 'up') this.count++
      this.phase = 'down'
    } else if (next === 'up' && this.phase === 'down') this.phase = 'up'
  }
}

export function taskSucceeded(task: FireTask, counters: [FanCounter, FanCounter], now: number, target: number) {
  return playerTaskResults(task, counters, now, target).every(Boolean)
}

export function playerTaskResults(task: FireTask, counters: [FanCounter, FanCounter], now: number, target: number): [boolean, boolean] {
  return counters.map((p, i) => {
    if (p.stillSince == null) return false
    if (task === 'big') return now - p.stillSince >= GAME_B_RULES.stillMs
    if ((task === 'left' && i === 1) || (task === 'right' && i === 0)) return p.count === 0
    return p.count >= target
  }) as [boolean, boolean]
}
