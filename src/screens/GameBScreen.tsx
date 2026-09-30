import type { GameClock } from '../game/gameClock'
import { useGamePause } from '../game/useGamePause'
import { GamePause } from '../components/GamePause'
import { useEffect, useRef, useState } from 'react'
import { GameBAvatar } from '../components/GameBAvatar'
import { Sprite } from '../components/Sprite'
import { GameTimer } from '../components/GameTimer'
import { FX, IMG, type Avatar as AvatarPick } from '../assets'
import { FIRE_FRAMES, GAME_B_IMAGES, preloadGameB, fireFrameIndex, type FireKind } from '../game/gameBAssets'
import { FanCounter, FIRE_GUIDES, GAME_B_EVENTS, GAME_B_RULES, taskSucceeded, playerTaskResults, type FireTask } from '../game/gameB'
import { poseEngine } from '../game/pose'
import { COUNTDOWN_CUES, COUNTDOWN_TOTAL_MS, beep, playCountdown, playSfx, runNarration, stopCountdown, type NarrationKey } from '../game/audio'
import { playBgm, stopBgm } from '../game/bgm'

type Stage = 'loading' | 'practice' | 'success' | 'welcome' | 'fadeOut' | 'fadeIn' | 'countdown' | 'main' | 'end'
type Avatars = { p1: AvatarPick; p2: AvatarPick }
const PRACTICE_VOICE: Record<FireTask, NarrationKey> = {
  stand: 'b_practice_both', left: 'b_practice_left', right: 'b_practice_right', big: 'b_stop',
}
const EVENT_VOICE: Record<FireTask, NarrationKey> = {
  stand: 'b_cue_both', left: 'b_cue_left', right: 'b_cue_right', big: 'b_stop',
}
export interface GameBResult {
  score: number
  completed: boolean
  events: { task: FireTask; correct: boolean; players: [boolean, boolean]; waves: [number, number] }[]
  startedAt: string
  rulesVersion: 'draft-1'
}

export function Fire({ kind, tutorial = false, opening = false, clock }: { kind: FireKind; tutorial?: boolean; opening?: boolean; clock?: GameClock }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    setFrame(0)
    const timer = (clock ?? window).setInterval(() => setFrame(n => n + 1), GAME_B_RULES.frameMs)
    return () => (clock ?? window).clearInterval(timer)
  }, [kind, clock])
  const blue = kind === 'big'
  const box = tutorial
    ? blue ? { left: 510, top: 280, width: 900, height: 675 } : { left: 430, top: 152.5, width: 1060, height: 795 }
    : { left: 527, top: opening ? 236 : 274, width: 865, height: 649 }
  const index = fireFrameIndex(kind, frame)
  const cropped = kind === 'big' && index >= 4
  return <div data-fire-kind={kind} data-fire-frame={index + 1} style={{ position: 'absolute', ...box, pointerEvents: 'none', transform: kind === 'right' ? 'scaleX(-1)' : undefined }}>
    <img src={FIRE_FRAMES[kind][index]} alt="" style={cropped
      ? { position: 'absolute', height: '98%', width: 'auto', left: '51.5%', bottom: '2%', transform: 'translateX(-50%)' }
      : { width: '100%', height: '100%', objectFit: 'contain' }} />
  </div>
}

export function GameBScreen({ avatars, skipPractice = false, onFinish, onExit }: {
  avatars: Avatars
  skipPractice?: boolean
  onFinish: (result: GameBResult) => void
  onExit: () => void
}) {
  const [stage, setStage] = useState<Stage>('loading')
  const { clock, paused, pause, resume } = useGamePause(stage !== 'loading' && stage !== 'end')
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [practiceIndex, setPracticeIndex] = useState(0)
  const [eventIndex, setEventIndex] = useState(0)
  const [waves, setWaves] = useState<[number, number]>([0, 0])
  const [live, setLive] = useState(() => [poseEngine.getPose(1), poseEngine.getPose(2)])
  const [score, setScore] = useState(0)
  const [remaining, setRemaining] = useState<number>(GAME_B_RULES.durationMs)
  const [countIdx, setCountIdx] = useState(-1)
  const [responseOpen, setResponseOpen] = useState(false)
  const [abortArmed, setAbortArmed] = useState(false)
  const abortTimer = useRef(0)
  const finish = useRef(onFinish)
  finish.current = onFinish
  const result = useRef<GameBResult>({ score: 0, completed: false, events: [], startedAt: '', rulesVersion: 'draft-1' })
  const task = stage === 'main' ? GAME_B_EVENTS[eventIndex] : (['stand', 'left', 'right', 'big'] as const)[practiceIndex]
  const tutorial = ['practice', 'success', 'welcome', 'fadeOut'].includes(stage)

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    preloadGameB().then(() => { if (!cancelled) setStage(skipPractice ? 'fadeIn' : 'practice') })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [skipPractice, loadAttempt])

  useEffect(() => {
    if (tutorial) playBgm('tutorial', 0.22)
    else stopBgm()
  }, [tutorial])
  useEffect(() => () => { stopBgm(); clock.clearTimeout(abortTimer.current) }, [])

  useEffect(() => {
    const timer = clock.setInterval(() => setLive([poseEngine.getPose(1), poseEngine.getPose(2)]), 100)
    return () => clock.clearInterval(timer)
  }, [])

  const sample = (counters: [FanCounter, FanCounter], now: number) => {
    const keyboard = !poseEngine.cameraOk && poseEngine.ready
    for (const [i, pid] of ([1, 2] as const).entries()) {
      const p = poseEngine.getPose(pid)
      counters[i].update({ ...p, present: keyboard || p.present }, now)
    }
    setWaves([counters[0].count, counters[1].count])
  }

  useEffect(() => {
    if (stage !== 'practice') return
    const counters: [FanCounter, FanCounter] = [new FanCounter(), new FanCounter()]
    const removeResume = clock.onResume(() => counters.forEach(counter => counter.resetPartial()))
    let ready = false
    setResponseOpen(false)
    const cancelVoice = runNarration(PRACTICE_VOICE[task], () => { ready = true; setResponseOpen(true) })
    setWaves([0, 0])
    const timer = clock.setInterval(() => {
      if (!ready) return
      const now = clock.now()
      sample(counters, now)
      // 연습 중 반대 참가자가 흔들었어도 다시 멈추면 재시도할 수 있다.
      if (task === 'left' && counters[1].restViolated) counters[1] = new FanCounter()
      if (task === 'right' && counters[0].restViolated) counters[0] = new FanCounter()
      if (taskSucceeded(task, counters, now, GAME_B_RULES.practiceWaves)) {
        clock.clearInterval(timer)
        playSfx('whistleShort')
        setStage('success')
      }
    }, 50)
    return () => { removeResume(); clock.clearInterval(timer); cancelVoice() }
  }, [stage, practiceIndex])

  useEffect(() => {
    if (stage !== 'success' && stage !== 'welcome') return
    if (stage === 'welcome') return runNarration('b_start', () => setStage('fadeOut'), 2200)
    const timer = clock.setTimeout(() => {
      if (practiceIndex === 3) setStage('welcome')
      else { setPracticeIndex(i => i + 1); setStage('practice') }
    }, 1000)
    return () => clock.clearTimeout(timer)
  }, [stage, practiceIndex])

  useEffect(() => {
    if (stage !== 'countdown') return
    const sound = playCountdown()
    const timers = COUNTDOWN_CUES.map((cue, i) => clock.setTimeout(() => {
      setCountIdx(i)
      if (!sound) beep(i === 3 ? 1320 : 880, 150)
    }, cue))
    timers.push(clock.setTimeout(() => { setCountIdx(-1); setStage('main') }, COUNTDOWN_TOTAL_MS))
    return () => { timers.forEach(clock.clearTimeout); stopCountdown() }
  }, [stage])

  useEffect(() => {
    if (stage !== 'main') return
    result.current = { score: 0, completed: false, events: [], startedAt: new Date().toISOString(), rulesVersion: 'draft-1' }
    const removeResume = clock.onResume(() => counters.forEach(counter => counter.resetPartial()))
    let index = 0
    let openedAt: number | null = null
    let cancelVoice = () => {}
    let counters: [FanCounter, FanCounter] = [new FanCounter(), new FanCounter()]
    const announce = () => {
      cancelVoice()
      openedAt = null
      counters = [new FanCounter(), new FanCounter()]
      setEventIndex(index)
      setWaves([0, 0])
      setResponseOpen(false)
      cancelVoice = runNarration(EVENT_VOICE[GAME_B_EVENTS[index]], () => {
        openedAt = clock.now()
        setResponseOpen(true)
      })
    }
    setEventIndex(0)
    setWaves([0, 0])
    announce()
    const timer = clock.setInterval(() => {
      if (openedAt === null) return
      const now = clock.now()
      const elapsed = now - openedAt
      setRemaining(Math.max(0, GAME_B_RULES.durationMs - index * GAME_B_RULES.eventMs - Math.min(elapsed, GAME_B_RULES.eventMs)))
      if (elapsed >= GAME_B_RULES.eventMs) {
        const correct = taskSucceeded(GAME_B_EVENTS[index], counters, now, GAME_B_RULES.eventWaves)
        result.current.events.push({ task: GAME_B_EVENTS[index], correct, players: playerTaskResults(GAME_B_EVENTS[index], counters, now, GAME_B_RULES.eventWaves), waves: [counters[0].count, counters[1].count] })
        if (correct) { result.current.score += GAME_B_RULES.pointsPerEvent; playSfx('whistleShort') }
        setScore(result.current.score)
        index++
        if (index >= GAME_B_EVENTS.length) {
          result.current.completed = true
          clock.clearInterval(timer)
          setStage('end')
          return
        }
        announce()
        return
      }
      sample(counters, now)
    }, 50)
    return () => { removeResume(); clock.clearInterval(timer); cancelVoice() }
  }, [stage])

  useEffect(() => {
    if (stage !== 'end') return
    playSfx('whistleLong')
    const timer = clock.setTimeout(() => finish.current(result.current), 1800)
    return () => clock.clearTimeout(timer)
  }, [stage])

  const abort = () => {
    if (clock.paused) return
    if (stage !== 'main') return
    if (abortArmed) { clock.clearTimeout(abortTimer.current); setStage('end') }
    else { setAbortArmed(true); abortTimer.current = clock.setTimeout(() => setAbortArmed(false), 4000) }
  }
  const skip = () => { if (!clock.paused && stage === 'practice') setStage('success') }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (clock.paused || e.repeat) return
      if (e.key === '1') skip()
      if (e.key === '2') abort()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (stage === 'loading') return <div className="fill game-b-loading">
    <p>{loadError ? '이미지를 불러오지 못했습니다' : '캠프파이어를 준비하고 있어요'}</p>
    {loadError && <button className="pixel-btn" onClick={() => setLoadAttempt(n => n + 1)}>다시 시도</button>}
    <button className="pixel-btn secondary" onClick={onExit}>마을로</button>
  </div>
  const welcome = stage === 'welcome' || stage === 'fadeOut'
  const fire: FireKind = stage === 'fadeIn' || stage === 'countdown' ? 'start' : task
  const guide = FIRE_GUIDES[task]
  const anim = stage === 'fadeOut' ? 'game-fade-out' : stage === 'fadeIn' ? 'game-fade-in' : ''
  return <div className={`fill game-b ${anim}`} data-game-paused={paused} data-game-b-stage={stage} data-event-index={eventIndex} data-response-open={responseOpen} onAnimationEnd={e => {
    if (clock.paused || e.target !== e.currentTarget) return
    if (stage === 'fadeOut' && e.animationName === 'gameFadeOut') setStage('fadeIn')
    if (stage === 'fadeIn' && e.animationName === 'gameFadeIn') setStage('countdown')
  }}>
    <img className="fill" src={tutorial ? GAME_B_IMAGES.tutorial : GAME_B_IMAGES.background} alt="" style={{ objectFit: 'cover', filter: tutorial ? undefined : 'blur(5.55px)' }} />
    {tutorial ? <>
      <p className="game-b-title">{welcome ? '잘 하셨어요' : guide.title}</p>
      <p className="game-b-guide">{welcome ? '이제 캠프파이어를 시작해볼까요?' : guide.guide}</p>
    </> : <>
      <GameTimer value={Math.ceil(remaining / 1000)} />
      <p className="game-b-score">{String(score).padStart(2, '0')}</p>
      {stage === 'main' && <p className="game-b-event">{task === 'big' ? guide.guide : task === 'stand' ? '함께 양손을 위아래로 2번 흔들어주세요!' : `${task === 'left' ? '왼쪽' : '오른쪽'} 사람만 2번 흔들고, 다른 사람은 멈춰주세요!`}</p>}
    </>}
    <div style={{ position: 'absolute', ...(tutorial ? { left: 627, top: 681, width: 705, height: 441 } : { left: 560, top: 637, width: 800, height: 500 }), overflow: 'hidden' }}>
      <img src={GAME_B_IMAGES.wood} alt="" style={{ position: 'absolute', width: '100%', height: '127.79%', top: '-13.99%' }} />
    </div>
    <Fire clock={clock} key={fire} kind={fire} tutorial={tutorial} opening={fire === 'start'} />
    {([0, 1] as const).map(i => <GameBAvatar key={i} avatar={i === 0 ? avatars.p1 : avatars.p2}
      pose={stage === 'success' || welcome ? 'tutorial' : task === 'big' ? 'stand' : live[i].leftRaised && live[i].rightRaised ? 'up' : 'down'}
      width={tutorial ? 419 : 356} left={tutorial ? i === 0 ? 274 : 1646 : i === 0 ? 299.5 : 1716} top={tutorial ? 712 : 750} />)}
    {tutorial && ([0, 1] as const).map(i => <div key={i}>
      {(stage === 'success' || welcome) && <Sprite frame={FX.good} style={{ left: i === 0 ? 138 : 1512, top: 564, width: 267, height: 148 }} />}
      {stage === 'practice' && task !== 'big' && <p className="game-b-waves" style={{ left: i === 0 ? 138 : 1512 }}>{Math.min(waves[i], 5)} / 5</p>}
    </div>)}
    {stage === 'countdown' && countIdx >= 0 && <img key={countIdx} className="pop" src={[IMG.count3, IMG.count2, IMG.count1, IMG.countStart][countIdx]} alt={['3', '2', '1', '시작'][countIdx]} style={{ position: 'absolute', left: 837, top: 417, width: 246, height: 246 }} />}
    {stage === 'end' && <img src={IMG.end} className="pop" alt="끝!" style={{ position: 'absolute', left: 629, top: 301, width: 777, height: 583 }} />}
    {(stage === 'practice' || stage === 'main') && <p className="voice-status" role="status">{responseOpen ? '지금 동작해 주세요' : '안내를 듣고 준비해 주세요'}</p>}
    {abortArmed && <p className="game-staff-notice" role="status">중단하려면 2를 한 번 더 눌러 주세요</p>}
  {stage !== 'end' && <GamePause paused={paused} onPause={pause} onResume={() => void resume()} />}
  </div>
}
