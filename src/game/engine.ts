// 게임 루프: React 렌더 사이클과 분리된 rAF 기반 상태 머신 (스펙 §7).
// [구령 발화(실측)] → [반응 창 2.0s] → [피드백 1.0s] 사이클.
// UI 갱신은 스냅샷 콜백을 100ms 단위로 throttle.

import type { Command, CommandLog, ErrorType, ExpectedAction, PlayerId, PlayerJudge } from './types'
import { poseEngine } from './pose'
import { speak, speakCommand, stopSpeech, goodChime, greatChime, neutralTick } from './audio'

export type Phase = 'idle' | 'speak' | 'window' | 'feedback' | 'roleswap' | 'done'

const WINDOW_MS = 2000
const FEEDBACK_MS = 1000
const ROLESWAP_MS = 5000
const HOLD_MS = 250 // 단발 노이즈 방지 유지 시간

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
}

export interface Snapshot {
  phase: Phase
  cmdIndex: number // 0-based
  command: Command | null
  windowRemainMs: number
  score: number
  judged: { p1: PlayerJudge; p2: PlayerJudge } | null
  live: {
    p1: { left: boolean; right: boolean }
    p2: { left: boolean; right: boolean }
  }
}

export interface RunnerOptions {
  commands: Command[]
  scored: boolean
  roleSwapAfter?: number // 이 인덱스 완료 후 역할 교체 화면 (0-based, 예: 9)
  onSnapshot: (s: Snapshot) => void
  onFinish: (logs: CommandLog[], score: number) => void
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

  constructor(opt: RunnerOptions) {
    this.opt = opt
  }

  start() {
    this.stopped = false
    this.nextCommand()
    this.raf = requestAnimationFrame(this.loop)
    // rAF는 창이 가려지면 정지하므로 인터벌 워치독으로 이어받는다 (부스 안전장치)
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastTick > 200) this.tick()
    }, 200)
  }

  stop() {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    window.clearInterval(this.watchdog)
    stopSpeech()
  }

  private get command(): Command | null {
    return this.opt.commands[this.cmdIndex] ?? null
  }

  private nextCommand() {
    this.cmdIndex += 1
    if (this.cmdIndex >= this.opt.commands.length) {
      this.phase = 'done'
      this.emit(true)
      this.opt.onFinish(this.logs, this.score)
      return
    }
    const now = performance.now()
    this.judged = null
    this.phase = 'speak'
    this.phaseStart = now
    // 구령 시작 시점 손 상태 기록 (이전 구령의 잔손은 재올림해야 인정)
    const p1 = poseEngine.getPose(1)
    const p2 = poseEngine.getPose(2)
    this.tracks = {
      1: { left: newHand(now, p1.leftRaised), right: newHand(now, p1.rightRaised) },
      2: { left: newHand(now, p2.leftRaised), right: newHand(now, p2.rightRaised) },
    }
    const cmd = this.command!
    speakCommand(cmd.words, cmd.text, cmd.isFake, spokenMs => {
      if (this.stopped || this.phase !== 'speak') return
      this.spokenMs = spokenMs
      this.phase = 'window'
      this.windowOpenAt = performance.now()
      this.phaseStart = this.windowOpenAt
      this.emit(true)
    })
    this.emit(true)
  }

  private loop = () => {
    if (this.stopped) return
    this.raf = requestAnimationFrame(this.loop)
    this.tick()
  }

  private tick() {
    if (this.stopped) return
    const now = performance.now()
    this.lastTick = now
    this.trackHands(now)

    if (this.phase === 'window' && now - this.windowOpenAt >= WINDOW_MS) {
      this.judge(now)
    } else if (this.phase === 'feedback' && now - this.phaseStart >= FEEDBACK_MS) {
      const swapAfter = this.opt.roleSwapAfter
      if (swapAfter != null && this.cmdIndex === swapAfter) {
        this.phase = 'roleswap'
        this.phaseStart = now
        speak('역할을 바꿔요! 이제 깃발 색이 바뀝니다!', false, () => undefined)
        this.emit(true)
      } else {
        this.nextCommand()
      }
    } else if (this.phase === 'roleswap' && now - this.phaseStart >= ROLESWAP_MS) {
      this.nextCommand()
    }

    this.emit(false)
  }

  private trackHands(now: number) {
    if (!this.tracks) return
    for (const pid of [1, 2] as PlayerId[]) {
      const pose = poseEngine.getPose(pid)
      const hands = { left: pose.leftRaised, right: pose.rightRaised }
      for (const hand of ['left', 'right'] as const) {
        const t = this.tracks[pid][hand]
        const up = hands[hand]
        if (up && !t.raised) {
          // 새로 올림
          t.raised = true
          t.raiseStart = now
          t.staleAtStart = false
          if (this.phase === 'speak') t.premature = true
        } else if (!up && t.raised) {
          t.raised = false
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
          if (this.phase === 'window' || this.phase === 'feedback') {
            if (t.raiseStart >= this.windowOpenAt && t.crossedAt == null) {
              t.crossedAt = t.raiseStart
            }
          }
        }
      }
    }
  }

  private judgePlayer(pid: PlayerId, expected: ExpectedAction): PlayerJudge {
    const t = this.tracks![pid]
    const premature = t.left.premature || t.right.premature
    const L = t.left.crossedAt != null || (t.left.raised && !t.left.staleAtStart && t.left.raiseStart >= this.windowOpenAt)
    const R = t.right.crossedAt != null || (t.right.raised && !t.right.staleAtStart && t.right.raiseStart >= this.windowOpenAt)
    const rtOf = (hand: 'left' | 'right') => {
      const c = t[hand].crossedAt ?? (t[hand].raised ? t[hand].raiseStart : null)
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
        if (!L && !R) correct = true
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
    const p1 = this.judgePlayer(1, cmd.expect.p1)
    const p2 = this.judgePlayer(2, cmd.expect.p2)
    this.judged = { p1, p2 }

    const nCorrect = (p1.correct ? 1 : 0) + (p2.correct ? 1 : 0)
    const gained = nCorrect === 2 ? 5 : nCorrect === 1 ? 3 : 1
    if (this.opt.scored) {
      this.score += gained
      this.logs.push({
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
    }

    // 실패 연출 배제(스펙 §6): 0명 정답이어도 부정적 사운드 대신 중립 톤
    if (nCorrect === 2) greatChime()
    else if (nCorrect === 1) goodChime()
    else neutralTick()

    this.phase = 'feedback'
    this.phaseStart = now
    this.emit(true)
  }

  private emit(force: boolean) {
    const now = performance.now()
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
      live: {
        p1: { left: p1.leftRaised, right: p1.rightRaised },
        p2: { left: p2.leftRaised, right: p2.rightRaised },
      },
    })
  }
}
