import type { GameClock } from './gameClock'
// 게임 루프: React 렌더 사이클과 분리된 rAF 기반 상태 머신 (스펙 §7).
// [구령 발화(실측)] → [반응 창 2.0s] → [피드백 1.0s] 사이클.
// UI 갱신은 스냅샷 콜백을 100ms 단위로 throttle.

import type { Command, CommandLog, ErrorType, ExpectedAction, PlayerId, PlayerJudge } from './types'
import { poseEngine } from './pose'
import { speakCommand, stopSpeech, neutralTick, playSfx, transitionChime } from './audio'

export type Phase = 'idle' | 'speak' | 'window' | 'feedback' | 'roleswap' | 'done'

const WINDOW_MS = 2000
const FEEDBACK_MS = 1000
const ROLESWAP_MS = 5000
const HOLD_MS = 250 // 단발 노이즈 방지 유지 시간
const PRACTICE_HOLD_MS = 400 // 연습: 두 사람이 자세를 이만큼 유지하면 통과

interface HandTrack {
  raised: boolean
  raiseStart: number // 이번 올림 시작 시각
  crossedAt: number | null // 반응 창 내 유효 통과 시각
  sustained: boolean
  premature: boolean // 발화 중 새로 올림
  staleAtStart: boolean // 구령 시작 전부터 올라가 있던 손 (재올림 필요)
}

interface PlayerTrack {
  left: HandTrack
  right: HandTrack
  observed: boolean
  inhibitionViolated: boolean
}

export interface Snapshot {
  phase: Phase
  cmdIndex: number // 0-based
  command: Command | null
  windowRemainMs: number
  score: number
  judged: { p1: PlayerJudge; p2: PlayerJudge } | null
  /** 연습 모드에서 각 플레이어가 지금 기대 동작을 만족하고 있는지 */
  practiceOk: { p1: boolean; p2: boolean }
  live: {
    p1: { left: boolean; right: boolean }
    p2: { left: boolean; right: boolean }
  }
}

export interface RunnerOptions {
  clock?: GameClock
  commands: Command[]
  scored: boolean
  /**
   * 연습 모드. 반응 창을 2초로 끊지 않고 **두 사람이 기대 동작을 함께 만들 때까지 기다린다.**
   * 시간 제한이 없으므로 조건을 만족하지 못하면 다음 구령으로 넘어가지 않는다.
   */
  waitForSuccess?: boolean
  /** 연습 설명이 끝났을 때 반응 창을 열고, 건너뛰기/종료 시 설명도 취소한다. */
  practiceNarration?: (command: Command, onEnd: (spokenMs: number) => void) => () => void
  roleSwapAfter?: number // 이 인덱스 완료 후 역할 교체 화면 (0-based, 예: 9)
  onSnapshot: (s: Snapshot) => void
  onFinish: (logs: CommandLog[], score: number) => void
  /** 구령 1개가 판정될 때마다 호출 — 실시간 전송용. 채점 세션에서만 발생한다. */
  onCommandLogged?: (log: CommandLog, index: number) => void
  /** 라운드 사이 역할 교체가 실제로 일어난 시점 */
  onRoleSwap?: (swapIndex: number) => void
}

function newHand(now: number, alreadyUp: boolean): HandTrack {
  return {
    raised: alreadyUp,
    raiseStart: alreadyUp ? now : 0,
    crossedAt: null,
    sustained: false,
    premature: false,
    staleAtStart: alreadyUp,
  }
}

export class GameRunner {
  private opt: RunnerOptions
  private raf = 0
  private watchdog = 0
  private lastTick = 0
  private phase: Phase = 'idle'
  private cmdIndex = -1
  private phaseStart = 0
  private windowOpenAt = 0
  private spokenMs = 0
  private score = 0
  private logs: CommandLog[] = []
  private tracks: Record<PlayerId, PlayerTrack> | null = null
  private judged: { p1: PlayerJudge; p2: PlayerJudge } | null = null
  private lastEmit = 0
  private stopped = false
  private cancelInstruction: (() => void) | null = null
  private onsetAt = ''
  private removeResume = () => {}
  private now = () => this.opt.clock?.now() ?? performance.now()
  private matchStart = 0 // 연습: 두 사람이 자세를 맞추기 시작한 시각

  constructor(opt: RunnerOptions) {
    this.opt = opt
  }

  start() {
    this.stopped = false
    this.removeResume = this.opt.clock?.onResume(() => this.resetPartialInput()) ?? (() => {})
    this.nextCommand()
    this.raf = requestAnimationFrame(this.loop)
    // 낮은 프레임률을 보완하되 일시정지 중에는 시계와 판정을 함께 멈춘다.
    this.watchdog = (this.opt.clock ?? window).setInterval(() => {
      if (this.now() - this.lastTick > 200) this.tick()
    }, 200)
  }

  stop() {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    const clock = this.opt.clock ?? window
    clock.clearInterval(this.watchdog)
    this.removeResume()
    stopSpeech()
    this.cancelInstruction?.()
    this.cancelInstruction = null
  }

  private get command(): Command | null {
    return this.opt.commands[this.cmdIndex] ?? null
  }

  /** 진행요원용: 대기 중인 구령을 통과 처리한다 (연습에서 동작 인식이 안 될 때의 예비 수단) */
  skipCurrent() {
    if (this.stopped || this.opt.clock?.paused || (this.phase !== 'window' && !(this.opt.waitForSuccess && this.phase === 'speak'))) return
    this.cancelInstruction?.()
    this.cancelInstruction = null
    stopSpeech()
    this.judge(this.now())
  }

  /** 진행요원용: 지금까지의 기록으로 게임을 끝낸다 (참가자 이탈 등) */
  abort() {
    if (this.stopped) return
    const { logs, score } = this
    this.stop()
    this.phase = 'done'
    this.judged = null
    // 마지막 스냅샷을 갱신해 구령 텍스트·타이머가 멈춘 채 남지 않게 한다
    this.emit(true)
    this.opt.onFinish(logs, score)
  }

  private nextCommand() {
    this.cancelInstruction?.()
    this.cancelInstruction = null
    this.cmdIndex += 1
    if (this.cmdIndex >= this.opt.commands.length) {
      this.phase = 'done'
      this.emit(true)
      this.opt.onFinish(this.logs, this.score)
      return
    }
    const now = this.now()
    this.judged = null
    this.matchStart = 0
    this.phase = 'speak'
    this.onsetAt = new Date().toISOString()
    this.phaseStart = now
    // 구령 시작 시점 손 상태 기록 (이전 구령의 잔손은 재올림해야 인정)
    const p1 = poseEngine.getPose(1)
    const p2 = poseEngine.getPose(2)
    this.tracks = {
      1: { left: newHand(now, p1.leftRaised), right: newHand(now, p1.rightRaised), observed: false, inhibitionViolated: false },
      2: { left: newHand(now, p2.leftRaised), right: newHand(now, p2.rightRaised), observed: false, inhibitionViolated: false },
    }
    const cmd = this.command!
    const index = this.cmdIndex
    const openWindow = (spokenMs: number) => {
      if (this.stopped || this.phase !== 'speak' || this.cmdIndex !== index) return
      this.spokenMs = spokenMs
      this.phase = 'window'
      this.windowOpenAt = this.now()
      this.phaseStart = this.windowOpenAt
      for (const pid of [1, 2] as PlayerId[]) {
        const p = poseEngine.getPose(pid)
        this.tracks![pid].observed = p.present && p.handsTracked !== false
        this.tracks![pid].inhibitionViolated = p.leftRaised || p.rightRaised
      }
      this.emit(true)
    }
    if (this.opt.waitForSuccess && this.opt.practiceNarration) {
      this.cancelInstruction = this.opt.practiceNarration(cmd, openWindow)
    } else speakCommand(cmd.words, cmd.text, cmd.isFake, openWindow)
    this.emit(true)
  }

  private loop = () => {
    if (this.stopped) return
    this.raf = requestAnimationFrame(this.loop)
    this.tick()
  }

  private tick() {
    if (this.stopped || this.opt.clock?.paused) return
    const now = this.now()
    this.lastTick = now
    this.trackHands(now)

    if (this.phase === 'window' && this.opt.waitForSuccess) {
      // 연습: 시간으로 끊지 않고 두 사람이 함께 성공할 때까지 기다린다
      if (this.practiceMatched(now)) this.judge(now)
    } else if (this.phase === 'window' && now - this.windowOpenAt >= WINDOW_MS) {
      this.judge(now)
    } else if (this.phase === 'feedback' && now - this.phaseStart >= FEEDBACK_MS) {
      const swapAfter = this.opt.roleSwapAfter
      if (swapAfter != null && this.cmdIndex === swapAfter) {
        this.opt.onRoleSwap?.(swapAfter)
        this.phase = 'roleswap'
        this.phaseStart = now
        transitionChime()
        this.emit(true)
      } else {
        this.nextCommand()
      }
    } else if (this.phase === 'roleswap' && now - this.phaseStart >= ROLESWAP_MS) {
      this.nextCommand()
    }

    this.emit(false)
  }

  private resetPartialInput() {
    this.matchStart = 0
    if (!this.tracks) return
    for (const pid of [1, 2] as PlayerId[]) {
      const pose = poseEngine.getPose(pid)
      for (const hand of ['left', 'right'] as const) {
        const before = this.tracks[pid][hand]
        if (before.crossedAt !== null) continue
        this.tracks[pid][hand] = { ...newHand(this.now(), hand === 'left' ? pose.leftRaised : pose.rightRaised), premature: before.premature }
      }
    }
  }

  private trackHands(now: number) {
    if (!this.tracks) return
    if (this.phase !== 'speak' && this.phase !== 'window') return
    for (const pid of [1, 2] as PlayerId[]) {
      const pose = poseEngine.getPose(pid)
      const player = this.tracks[pid]
      if (!pose.present || pose.handsTracked === false) {
        if (this.phase === 'window') player.observed = false
        for (const hand of ['left', 'right'] as const) {
          player[hand].raised = false
          player[hand].sustained = false
        }
        continue
      }
      if (this.phase === 'window' && (pose.leftRaised || pose.rightRaised)) player.inhibitionViolated = true
      const hands = { left: pose.leftRaised, right: pose.rightRaised }
      for (const hand of ['left', 'right'] as const) {
        const t = this.tracks[pid][hand]
        const up = hands[hand]
        if (up && !t.raised) {
          // 새로 올림
          t.raised = true
          t.raiseStart = now
          t.sustained = false
          t.staleAtStart = false
          if (this.phase === 'speak') t.premature = true
        } else if (!up && t.raised) {
          t.raised = false
          t.sustained = false
          t.staleAtStart = false
        }
        // 유지 시간 충족 체크 (반응 창 내 시작한 올림만 유효 통과로 기록)
        if (
          t.raised &&
          !t.staleAtStart &&
          !t.sustained &&
          now - t.raiseStart >= HOLD_MS
        ) {
          t.sustained = true
          if (this.phase === 'window') {
            if (t.raiseStart >= this.windowOpenAt &&
              (this.opt.waitForSuccess || t.raiseStart + HOLD_MS <= this.windowOpenAt + WINDOW_MS) &&
              t.crossedAt == null) {
              t.crossedAt = t.raiseStart
            }
          }
        }
      }
    }
  }

  /** 지금 이 순간 플레이어의 손 상태가 기대 동작과 일치하는지 (연습 모드 판정용) */
  private poseMatches(pid: PlayerId, expected: ExpectedAction): boolean {
    const p = poseEngine.getPose(pid)
    if (!p.present || p.handsTracked === false) return false
    switch (expected) {
      case 'none':
        return !p.leftRaised && !p.rightRaised
      case 'both':
        return p.leftRaised && p.rightRaised
      case 'left':
        return p.leftRaised && !p.rightRaised
      case 'right':
        return p.rightRaised && !p.leftRaised
    }
  }

  /** 두 사람이 동시에 기대 동작을 PRACTICE_HOLD_MS 동안 유지했는가 */
  private practiceMatched(now: number): boolean {
    const cmd = this.command
    if (!cmd) return false
    const ok = this.poseMatches(1, cmd.expect.p1) && this.poseMatches(2, cmd.expect.p2)
    if (!ok) {
      this.matchStart = 0
      return false
    }
    if (!this.matchStart) this.matchStart = now
    return now - this.matchStart >= PRACTICE_HOLD_MS
  }

  private judgePlayer(pid: PlayerId, expected: ExpectedAction): PlayerJudge {
    const t = this.tracks![pid]
    if (!t.observed) return { correct: false, errorType: '누락', reactionMs: null }
    const premature = t.left.premature || t.right.premature
    const L = t.left.crossedAt != null
    const R = t.right.crossedAt != null
    const rtOf = (hand: 'left' | 'right') => {
      const c = t[hand].crossedAt
      return c != null ? Math.max(0, Math.round(c - this.windowOpenAt)) : null
    }

    if (premature) {
      return { correct: false, errorType: '조급반응', reactionMs: null }
    }

    let correct = false
    let errorType: ErrorType = null
    let reactionMs: number | null = null

    switch (expected) {
      case 'none':
        if (!t.inhibitionViolated) correct = true
        else errorType = '오작동'
        break
      case 'both':
        if (L && R) {
          correct = true
          reactionMs = Math.max(rtOf('left') ?? 0, rtOf('right') ?? 0)
        } else if (L || R) errorType = '부분수행'
        else errorType = '누락'
        break
      case 'left':
        if (L && !R) {
          correct = true
          reactionMs = rtOf('left')
        } else if (R) errorType = '오손'
        else errorType = '누락'
        break
      case 'right':
        if (R && !L) {
          correct = true
          reactionMs = rtOf('right')
        } else if (L) errorType = '오손'
        else errorType = '누락'
        break
    }
    return { correct, errorType, reactionMs }
  }

  private judge(now: number) {
    const cmd = this.command!
    // 연습은 성공해서 이 지점에 도달한 것이므로 정답으로 확정한다.
    // (창 기반 판정은 발화 중 미리 든 손을 조급반응으로 보지만, 연습에선 벌점 개념이 없다)
    const ok = (): PlayerJudge => ({ correct: true, errorType: null, reactionMs: null })
    const p1 = this.opt.waitForSuccess ? ok() : this.judgePlayer(1, cmd.expect.p1)
    const p2 = this.opt.waitForSuccess ? ok() : this.judgePlayer(2, cmd.expect.p2)
    this.judged = { p1, p2 }

    const nCorrect = (p1.correct ? 1 : 0) + (p2.correct ? 1 : 0)
    const gained = nCorrect === 2 ? 5 : nCorrect === 1 ? 3 : 1
    if (this.opt.scored) {
      this.score += gained
      this.logs.push({
        구령시작시각: this.onsetAt,
        구령ID: cmd.id,
        레벨: cmd.level,
        구령: cmd.text,
        기대동작: { P1: cmd.expect.p1, P2: cmd.expect.p2 },
        판정: {
          P1: { 정답: p1.correct, 오류유형: p1.errorType, 반응속도ms: p1.reactionMs },
          P2: { 정답: p2.correct, 오류유형: p2.errorType, 반응속도ms: p2.reactionMs },
        },
        획득점수: gained,
        발화길이ms: Math.round(this.spokenMs),
      })
      this.opt.onCommandLogged?.(this.logs[this.logs.length - 1], this.cmdIndex)
    }

    // GOOD / GREAT 이펙트가 뜨는 순간 진행자 휘슬을 분다.
    // 실패 연출 배제(스펙 §6): 0명 정답이면 휘슬 없이 중립 톤만 (부정적 소리 아님)
    if (nCorrect > 0) playSfx('whistleShort')
    else neutralTick()

    this.phase = 'feedback'
    this.phaseStart = now
    this.emit(true)
  }

  private emit(force: boolean) {
    const now = this.now()
    if (!force && now - this.lastEmit < 100) return
    this.lastEmit = now
    const p1 = poseEngine.getPose(1)
    const p2 = poseEngine.getPose(2)
    this.opt.onSnapshot({
      phase: this.phase,
      cmdIndex: this.cmdIndex,
      command: this.command,
      windowRemainMs:
        this.phase === 'window' ? Math.max(0, WINDOW_MS - (now - this.windowOpenAt)) : 0,
      score: this.score,
      judged: this.judged,
      practiceOk: this.command
        ? {
            p1: this.poseMatches(1, this.command.expect.p1),
            p2: this.poseMatches(2, this.command.expect.p2),
          }
        : { p1: false, p2: false },
      live: {
        p1: { left: p1.leftRaised, right: p1.rightRaised },
        p2: { left: p2.leftRaised, right: p2.rightRaised },
      },
    })
  }
}
