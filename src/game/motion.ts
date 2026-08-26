/**
 * 동작 지표 샘플러
 *
 * 포즈 엔진이 프레임마다 갱신하는 상태를 훑어 **1초 창**으로 집계한다.
 * 프레임 단위 랜드마크를 그대로 올리면 용량이 터지고, 개인정보 부담도 커진다.
 * 원본 좌표는 이 파일 밖으로 나가지 않는다 — 나가는 것은 파생 숫자뿐이다.
 *
 * 측정하지 않는 것
 *  - 관절 «각도»: 포즈 엔진은 어깨선 대비 손목 높이만 준다. 각도인 척하지 않는다.
 *  - 앉음/섬: 판별할 근거가 없다. 추측해서 넣지 않는다.
 *  - 심박·근력·칼로리: 카메라로는 불가능하다.
 */

import { poseEngine } from './pose'
import type { PlayerId } from './types'
import { logMotionWindows } from './telemetry'

const SAMPLE_MS = 50 // 20Hz. 포즈 갱신(~12fps)보다 촘촘히 훑어 비율 계산을 안정시킨다
const WINDOW_MS = 1000
const FLUSH_EVERY = 5 // 창 5개(=5초)마다 묶어서 보낸다

export interface MotionWindow {
  actor_code: 'P1' | 'P2'
  window_start: string
  rep_count: number
  cadence_spm: number
  lift_max: number | null
  lift_mean: number | null
  active_ratio: number
  symmetry_index: number | null
  trunk_sway_sd: number | null
  presence_ratio: number
  n_samples: number
}

interface Acc {
  n: number
  present: number
  activeSamples: number
  lifts: number[]
  noseX: number[]
  noseY: number[]
  repsLeft: number
  repsRight: number
  wasLeft: boolean
  wasRight: boolean
}

const freshAcc = (): Acc => ({
  n: 0, present: 0, activeSamples: 0, lifts: [], noseX: [], noseY: [],
  repsLeft: 0, repsRight: 0, wasLeft: false, wasRight: false,
})

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

function sd(a: number[]): number | null {
  if (a.length < 2) return null
  const m = mean(a)!
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

const round = (v: number | null, d: number) =>
  v === null || !Number.isFinite(v) ? null : Number(v.toFixed(d))

class MotionSampler {
  private timer = 0
  private windowTimer = 0
  private acc: Record<PlayerId, Acc> = { 1: freshAcc(), 2: freshAcc() }
  private windowStart = 0
  private pending: MotionWindow[] = []
  private running = false

  start() {
    if (this.running) return
    this.running = true
    this.acc = { 1: freshAcc(), 2: freshAcc() }
    this.windowStart = Date.now()
    this.timer = window.setInterval(() => this.sample(), SAMPLE_MS)
    this.windowTimer = window.setInterval(() => this.closeWindow(), WINDOW_MS)
  }

  stop() {
    if (!this.running) return
    this.running = false
    window.clearInterval(this.timer)
    window.clearInterval(this.windowTimer)
    this.closeWindow()
    this.flush()
  }

  private sample() {
    for (const pid of [1, 2] as PlayerId[]) {
      const p = poseEngine.getPose(pid)
      const a = this.acc[pid]
      a.n += 1
      if (!p.present) {
        // 사람이 안 잡히면 그 표본은 «없음»이다. 0 으로 치환하면 평균이 거짓이 된다.
        a.wasLeft = false
        a.wasRight = false
        continue
      }
      a.present += 1

      // 손을 든 «순간»만 센다 (false → true 전이). 들고 있는 동안 계속 세면 반복이 부풀려진다.
      if (p.leftRaised && !a.wasLeft) a.repsLeft += 1
      if (p.rightRaised && !a.wasRight) a.repsRight += 1
      a.wasLeft = p.leftRaised
      a.wasRight = p.rightRaised

      if (p.leftRaised || p.rightRaised) a.activeSamples += 1

      // 어깨선 대비 손목 높이. 화면 좌표는 위가 작으므로 (어깨 - 손목)이 양수면 들어올린 것.
      if (p.shoulderY != null) {
        const lifts: number[] = []
        if (p.leftWristY != null) lifts.push(p.shoulderY - p.leftWristY)
        if (p.rightWristY != null) lifts.push(p.shoulderY - p.rightWristY)
        if (lifts.length) a.lifts.push(Math.max(...lifts))
      }

      if (p.noseX != null) a.noseX.push(p.noseX)
      if (p.noseY != null) a.noseY.push(p.noseY)
    }
  }

  private closeWindow() {
    const startedAt = new Date(this.windowStart).toISOString()
    this.windowStart = Date.now()

    for (const pid of [1, 2] as PlayerId[]) {
      const a = this.acc[pid]
      this.acc[pid] = freshAcc()
      if (!a.n) continue

      const reps = a.repsLeft + a.repsRight
      const swayX = sd(a.noseX)
      const swayY = sd(a.noseY)
      const sway = swayX != null && swayY != null ? Math.hypot(swayX, swayY) : null

      this.pending.push({
        actor_code: pid === 1 ? 'P1' : 'P2',
        window_start: startedAt,
        rep_count: reps,
        cadence_spm: reps * 60, // 창이 1초이므로 분당 환산은 ×60
        lift_max: a.lifts.length ? round(Math.max(...a.lifts), 3) : null,
        lift_mean: round(mean(a.lifts), 3),
        active_ratio: round(a.present ? a.activeSamples / a.present : 0, 3)!,
        symmetry_index: reps ? round(1 - Math.abs(a.repsLeft - a.repsRight) / reps, 3) : null,
        trunk_sway_sd: round(sway, 3),
        presence_ratio: round(a.present / a.n, 3)!,
        n_samples: a.n,
      })
    }

    if (this.pending.length >= FLUSH_EVERY * 2) this.flush()
  }

  private flush() {
    if (!this.pending.length) return
    const batch = this.pending
    this.pending = []
    logMotionWindows(batch)
  }
}

export const motionSampler = new MotionSampler()
