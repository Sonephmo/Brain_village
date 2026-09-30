import { useGamePause } from '../game/useGamePause'
import { GamePause } from '../components/GamePause'
import { useEffect, useRef, useState } from 'react'
import { FX, IMG } from '../assets'
import { Sprite } from '../components/Sprite'
import { GameCRabbit, RiceCake } from '../components/GameCRabbit'
import { GameCEffect } from '../components/GameCEffect'
import { GameTimer } from '../components/GameTimer'
import { GameCMoonScore } from '../components/GameCMoonScore'
import { GAME_C_IMAGES, preloadGameC, type RabbitPose } from '../game/gameCAssets'
import { GAME_C_RULES, RICE_CUES, RICE_CUE_MS, RICE_TOTAL_MS, RICE_GUIDES, RICE_PRACTICE, RICE_MOTION_REST, RiceActionTracker, RiceFinishTracker, RiceMotion, ricePoundPose,
  freshRiceResult, ricePlayerStats, type GameCResult, type Grip, type Rabbits, type RiceFeedback, type RiceInput } from '../game/gameC'
import { riceGripEngine } from '../game/gameCGrip'
import { poseEngine } from '../game/pose'
import { playBgm, stopBgm } from '../game/bgm'
import { COUNTDOWN_CUES, COUNTDOWN_TOTAL_MS, playCountdown, playSfx, runNarration, stopCountdown, type NarrationKey } from '../game/audio'
import type { PlayerId } from '../game/types'

type Stage = 'loading' | 'practice' | 'practiceFeedback' | 'practiceSwap' | 'welcome' |
  'fadeOut' | 'fadeIn' | 'backgroundHold' | 'backgroundFocus' | 'uiReveal' |
  'countdown' | 'play' | 'feedback' | 'swap' | 'finish' | 'end'
const emptyInput = (): RiceInput => ({ tracked: false, left: false, right: false, aboveHead: false, grip: 'unknown' })
const PRACTICE_VOICE: Record<string, NarrationKey> = { pound: 'c_practice_pound', squeeze: 'c_practice_squeeze', left: 'c_practice_left', right: 'c_practice_right' }
const CUE_VOICE: Record<string, NarrationKey> = { pound: 'c_cue_pound', squeeze: 'c_cue_squeeze', left: 'c_cue_left', right: 'c_cue_right' }

export function GameCScreen({ rabbits, skipPractice = false, onFinish, onExit }: {
  rabbits: Rabbits; skipPractice?: boolean; onFinish: (result: GameCResult) => void; onExit: () => void
}) {
  const [stage, setStage] = useState<Stage>('loading')
  const { clock, paused, pause, resume } = useGamePause(stage !== 'loading' && stage !== 'end')
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [practiceIndex, setPracticeIndex] = useState(0)
  const [cueIndex, setCueIndex] = useState(0)
  const [remaining, setRemaining] = useState(RICE_TOTAL_MS / 1000)
  const [score, setScore] = useState(0)
  const [countdown, setCountdown] = useState(-1)
  const [responseOpen, setResponseOpen] = useState(false)
  const [live, setLive] = useState<[RiceInput, RiceInput]>([emptyInput(), emptyInput()])
  const [squeezes, setSqueezes] = useState(0)
  const [matched, setMatched] = useState(false)
  const [effect, setEffect] = useState<{ id: number; kind: RiceFeedback } | null>(null)
  const effectId = useRef(0)
  const motion = useRef(new RiceMotion())
  const [motionFrame, setMotionFrame] = useState(RICE_MOTION_REST)
  const reducedMotion = useRef(false)
  const [finishProgress, setFinishProgress] = useState(0)
  const [armed, setArmed] = useState(false)
  const [forceKeyboard, setForceKeyboard] = useState(false)
  const keyboardRef = useRef(false)
  keyboardRef.current = forceKeyboard
  const result = useRef(freshRiceResult())
  const tracker = useRef<RiceActionTracker | null>(null)
  const keys = useRef(new Set<string>())
  const armTimer = useRef(0)
  const finishRef = useRef(onFinish)
  finishRef.current = onFinish
  const practicing = ['practice', 'practiceFeedback', 'practiceSwap', 'welcome', 'fadeOut'].includes(stage)
  const introducing = ['fadeOut', 'fadeIn', 'backgroundHold', 'backgroundFocus', 'uiReveal'].includes(stage)
  const cue = practicing ? RICE_PRACTICE[practiceIndex] : RICE_CUES[cueIndex]
  const guide = RICE_GUIDES[cue.action]
  const swapped = stage === 'practiceSwap' || stage === 'swap' || cue.round === 2
  const poundingPlayer: PlayerId = swapped ? 2 : 1
  const keyboardOnly = forceKeyboard || (poseEngine.ready && !poseEngine.cameraOk) || Boolean(riceGripEngine.error)

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    preloadGameC().then(() => {
      if (!cancelled) setStage(skipPractice ? 'fadeIn' : 'practice')
    }).catch(() => { if (!cancelled) setLoadError(true) })
    // Warm the independent two-hand model before the kneading practice.
    if (poseEngine.cameraOk) void riceGripEngine.init()
    return () => { cancelled = true }
  }, [attempt, skipPractice])
  useEffect(() => {
    if (practicing) playBgm('tutorial', 0.22)
    else stopBgm()
  }, [practicing])
  useEffect(() => () => { stopBgm(); riceGripEngine.reset(); clock.clearTimeout(armTimer.current) }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { reducedMotion.current = preference.matches }
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (!clock.paused && !event.repeat) keys.current.add(event.key.toLowerCase()) }
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const clear = () => keys.current.clear()
    const removePause = clock.onPause(clear)
    const removeResume = clock.onResume(clear)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => { removePause(); removeResume(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear) }
  }, [])

  useEffect(() => {
    if (stage === 'loading') return
    const accepting = stage === 'practice' || stage === 'play'
    const showingFeedback = stage === 'practiceFeedback' || stage === 'feedback'
    let started = clock.now()
    let ready = !accepting && stage !== 'finish'
    setResponseOpen(false)
    let counter = new RiceActionTracker(cue.action, started)
    tracker.current = accepting ? counter : null
    riceGripEngine.reset()
    if (accepting) {
      setSqueezes(0)
      setMatched(false)
    }
    if (!showingFeedback) {
      setEffect(null)
      motion.current.reset()
      setMotionFrame(RICE_MOTION_REST)
    }
    let finishCounter = new RiceFinishTracker()
    const removeResume = clock.onResume(() => {
      counter.resetPartial()
      finishCounter = new RiceFinishTracker()
      riceGripEngine.reset()
      if (stage === 'finish') setFinishProgress(0)
    })
    if (stage === 'finish') setFinishProgress(0)
    const cancelVoice = accepting || stage === 'finish' ? runNarration(
      stage === 'finish' ? 'c_finish' : (stage === 'practice' ? PRACTICE_VOICE : CUE_VOICE)[cue.action],
      () => {
        started = clock.now()
        counter = new RiceActionTracker(cue.action, started)
        tracker.current = accepting ? counter : null
        finishCounter = new RiceFinishTracker()
        riceGripEngine.reset()
        ready = true
        setResponseOpen(true)
      },
    ) : () => {}
    let previousKeyboard = keyboardRef.current || (poseEngine.ready && !poseEngine.cameraOk) || Boolean(riceGripEngine.error)
    let waitingForHands = false
    const timer = clock.setInterval(() => {
      const now = clock.now()
      if (poseEngine.cameraOk && !riceGripEngine.ready && !riceGripEngine.error) void riceGripEngine.init()
      const kb = keyboardRef.current || (poseEngine.ready && !poseEngine.cameraOk) || Boolean(riceGripEngine.error)
      if (ready && accepting && cue.action === 'squeeze' && !kb && !riceGripEngine.ready) {
        waitingForHands = true
        started = now
      } else if (waitingForHands) {
        // Response and reaction clocks start only once finger inference is available.
        waitingForHands = false
        started = now
        counter = new RiceActionTracker(cue.action, started)
        tracker.current = counter
      }
      const elapsed = now - started
      if (kb !== previousKeyboard) {
        // Switching input sources must not complete a movement started on the other source.
        previousKeyboard = kb
        counter = new RiceActionTracker(cue.action, started)
        tracker.current = accepting ? counter : null
        finishCounter = new RiceFinishTracker()
        motion.current.reset()
        setEffect(null)
      }
      const readInput = (pid: PlayerId): RiceInput => {
        const left = keys.current.has(pid === 1 ? 'q' : 'o')
        const right = keys.current.has(pid === 1 ? 'w' : 'p')
        const body = kb ? { tracked: true, left, right, aboveHead: left && right } : poseEngine.getCBody(pid)
        const key = pid === 1 ? 'e' : 'i'
        let grip: Grip = 'unknown'
        if (kb) grip = keys.current.has(key) ? 'closed' : 'open'
        else if (accepting && cue.action === 'squeeze' && cue.player === pid) grip = riceGripEngine.sample(pid, performance.now())
        // Finger landmarks already establish the two hands. Foreshortened wrists in
        // the separate body model must not veto a valid hand gesture.
        const squeezing = accepting && cue.action === 'squeeze' && cue.player === pid
        return { ...body, tracked: kb || (squeezing ? grip !== 'unknown' && poseEngine.getPose(pid).present : body.tracked), grip }
      }
      const inputs: [RiceInput, RiceInput] = [readInput(1), readInput(2)]
      const performer = inputs[cue.player - 1]
      setLive(inputs)
      // Missing tracking is never a strike or continuing kneading motion.
      if (!performer.tracked || (accepting && cue.action === 'squeeze' && performer.grip === 'unknown')) motion.current.reset()
      if (!accepting) setMotionFrame(motion.current.sample(now, reducedMotion.current))
      if (!ready) return
      if (stage === 'finish') {
        const progress = finishCounter.update(inputs, now)
        setFinishProgress(progress)
        if (progress >= 1) {
          result.current.finishPoseCompleted = true
          clock.clearInterval(timer)
          setStage('end')
        }
        return
      }
      // Keep hand-driven poses live during feedback/countdown without accepting actions.
      if (!accepting) return
      // A late sample outside the response window cannot turn a miss into a success.
      if (stage === 'practice' || elapsed <= GAME_C_RULES.responseMs) {
        const previousMovement = counter.movementAt
        const feedback = counter.update(performer, now)
        if (cue.action !== 'pound' && counter.movementAt !== previousMovement) motion.current.assist(now)
        if (feedback === 'star') motion.current.strike(now)
        if (feedback) setEffect({ id: ++effectId.current, kind: feedback })
      }
      setMotionFrame(motion.current.sample(now, reducedMotion.current))
      setSqueezes(counter.count)
      setMatched(counter.complete)
      if (stage === 'practice' && counter.complete) {
        clock.clearInterval(timer)
        playSfx('whistleShort')
        setStage('practiceFeedback')
      } else if (stage === 'play') {
        setRemaining(Math.max(0, Math.ceil((RICE_TOTAL_MS - cueIndex * RICE_CUE_MS - Math.min(elapsed, GAME_C_RULES.responseMs)) / 1000)))
        if (elapsed >= GAME_C_RULES.responseMs) {
          clock.clearInterval(timer)
          const trial = counter.result(cue)
          result.current.trials.push(trial)
          if (trial.outcome === 'correct') { result.current.score += GAME_C_RULES.points; playSfx('whistleShort') }
          setScore(result.current.score)
          setStage('feedback')
        }
      }
    }, 50)
    return () => { removeResume(); clock.clearInterval(timer); tracker.current = null; cancelVoice() }
  }, [stage, practiceIndex, cueIndex])

  const afterPractice = () => {
    if (practiceIndex === 4) setStage('practiceSwap')
    else if (practiceIndex === RICE_PRACTICE.length - 1) setStage('welcome')
    else { setPracticeIndex(n => n + 1); setStage('practice') }
  }
  useEffect(() => {
    let timer = 0
    if (stage === 'practiceFeedback') timer = clock.setTimeout(afterPractice, 900)
    if (stage === 'practiceSwap') return runNarration('c_swap', () => { setPracticeIndex(5); setStage('practice') }, GAME_C_RULES.swapMs)
    if (stage === 'welcome') timer = clock.setTimeout(() => setStage('fadeOut'), 2400)
    if (stage === 'backgroundHold') timer = clock.setTimeout(() => setStage('backgroundFocus'), 3000)
    if (stage === 'feedback') timer = clock.setTimeout(() => {
      setRemaining(Math.max(0, Math.ceil((RICE_TOTAL_MS - (cueIndex + 1) * RICE_CUE_MS) / 1000)))
      if (cueIndex === RICE_CUES.length - 1) {
        result.current.completed = true
        setStage(result.current.score >= GAME_C_RULES.passScore ? 'finish' : 'end')
      } else if (cueIndex === 9) setStage('swap')
      else { setCueIndex(n => n + 1); setStage('play') }
    }, GAME_C_RULES.feedbackMs)
    if (stage === 'swap') return runNarration('c_swap', () => { setCueIndex(10); setStage('play') }, GAME_C_RULES.swapMs)
    if (stage === 'end') {
      playSfx('whistleLong')
      timer = clock.setTimeout(() => finishRef.current({ ...result.current, trials: [...result.current.trials] }), 1600)
    }
    return () => clock.clearTimeout(timer)
  }, [stage, practiceIndex, cueIndex])

  useEffect(() => {
    if (stage !== 'countdown') return
    setCueIndex(0)
    playCountdown()
    const timers = COUNTDOWN_CUES.map((at, index) => clock.setTimeout(() => setCountdown(index), at))
    timers.push(clock.setTimeout(() => {
      result.current = { ...freshRiceResult(), startedAt: new Date().toISOString() }
      setCountdown(-1)
      setStage('play')
    }, COUNTDOWN_TOTAL_MS))
    return () => { timers.forEach(clock.clearTimeout); stopCountdown() }
  }, [stage])

  const skip = () => {
    if (clock.paused) return
    if (stage === 'practice') afterPractice()
    else if (stage === 'practiceSwap') { setPracticeIndex(5); setStage('practice') }
    else if (stage === 'welcome') setStage('fadeOut')
    else if (stage === 'finish') setStage('end') // Never claims the final pose was performed.
  }
  const abort = () => {
    if (clock.paused) return
    if (!['play', 'feedback', 'swap', 'finish'].includes(stage)) return
    if (armed) { clock.clearTimeout(armTimer.current); setStage('end') }
    else { setArmed(true); armTimer.current = clock.setTimeout(() => setArmed(false), 4000) }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (clock.paused || event.repeat) return
      if (event.key === '1') skip()
      if (event.key === '2') abort()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (stage === 'loading') return <div className="fill game-c-loading">
    <p>{loadError ? '떡방아 그림을 불러오지 못했어요' : '보름달 떡집을 준비하고 있어요'}</p>
    {loadError && <button className="pixel-btn" onClick={() => setAttempt(n => n + 1)}>다시 시도</button>}
    <button className="pixel-btn secondary" onClick={onExit}>마을로</button>
  </div>

  const swap = stage === 'practiceSwap' || stage === 'swap'
  const finishing = stage === 'finish' || stage === 'end'
  const riceComplete = result.current.completed && result.current.score >= GAME_C_RULES.passScore
  const title = swap ? '역할 바꾸기' : stage === 'welcome' || stage === 'fadeOut' ? '훈련 완료' : finishing
    ? riceComplete ? '떡 완성!' : '수고하셨습니다' : guide.title
  const showBubble = ['practice', 'practiceFeedback', 'uiReveal', 'countdown', 'play', 'feedback'].includes(stage)
  const showUi = practicing || !introducing || stage === 'uiReveal'
  const onLeft = cue.player === 1
  const rabbitPose = (pid: PlayerId): RabbitPose => {
    if (pid === poundingPlayer) return ricePoundPose(live[pid - 1])
    return motionFrame.assistPose
  }

  return <div className={`fill game-c ${practicing ? 'fade-in' : 'game-c-main'}`} data-game-paused={paused} data-game-c-stage={stage} data-cue-index={cueIndex} data-practice-index={practiceIndex} data-response-open={responseOpen}>
    {practicing && <img src={GAME_C_IMAGES.tutorial} alt="" className="fill" />}
    {!practicing && <div className="game-c-play-background" onAnimationEnd={event => {
      if (clock.paused) return
      if (event.target === event.currentTarget && event.animationName === 'gameCBackgroundFocus' && stage === 'backgroundFocus') setStage('uiReveal')
    }}>
      <img src={GAME_C_IMAGES.playOriginal} alt="" />
      <img src={GAME_C_IMAGES.playBackground} alt="" className="game-c-exposed-background" />
    </div>}
    {showUi && <div className={`fill game-c-ui ${stage === 'uiReveal' ? 'scene-ui-dissolve' : ''}`}
      aria-hidden={introducing} ref={element => { if (element) element.inert = introducing }}
      onAnimationEnd={event => {
      if (clock.paused) return
        if (event.target === event.currentTarget && event.animationName === 'sceneUiDissolve' && stage === 'uiReveal') setStage('countdown')
      }}>
    {(practicing || swap || finishing) && <h1 className="game-c-title">{title}</h1>}
    {!finishing && <>
      <img src={GAME_C_IMAGES.wood} alt="" className="game-c-wood" />
      <img src={GAME_C_IMAGES.dough[motionFrame.dough - 1]} alt="" className="game-c-dough" data-dough={motionFrame.dough} />
      <GameCRabbit rabbit={rabbits.p1} side={1} pose={rabbitPose(1)} style={{ left: swapped ? 442 : 398 }} />
      <GameCRabbit rabbit={rabbits.p2} side={2} pose={rabbitPose(2)} style={{ left: swapped ? 842 : 768 }} />
    </>}
    {showBubble && <div className={`game-c-bubble ${onLeft ? 'left' : 'right'}`}>
      <img alt="" src={practicing ? GAME_C_IMAGES.bubble : GAME_C_IMAGES.playBubble} />
      <p>{guide.speech}</p>
    </div>}
    {showBubble && matched && <Sprite frame={FX.good} style={{ left: onLeft ? 604 : 1011, top: 186, width: 267, height: 148 }} />}
    {showBubble && effect && <GameCEffect key={effect.id} kind={effect.kind} />}
    {showBubble && cue.action === 'squeeze' && <p className="game-c-count" style={{ left: onLeft ? 638 : 1055 }}>{Math.min(3, squeezes)} / 3</p>}
    {practicing && <p className="game-c-guide">{swap ? '이제 서로 역할을 바꿉니다\n오른쪽이 메질, 왼쪽이 떡 정리 역할입니다'
      : stage === 'welcome' || stage === 'fadeOut' ? '잘하셨습니다!\n이제 본격적으로 떡 만들기를 시작해볼까요?' : guide.guide}</p>}
    {swap && !practicing && <p className="game-c-guide">{'이제 서로 역할을 바꿉니다\n오른쪽이 메질, 왼쪽이 떡 정리 역할입니다'}</p>}
    {!practicing && !finishing && !swap && <>
      <GameTimer value={remaining} />
      {([1, 2] as const).map(player => {
        const stats = ricePlayerStats(result.current, player)
        return <GameCMoonScore key={player} player={player} score={stats.score} maxScore={stats.maxScore} />
      })}
    </>}
    {stage === 'countdown' && countdown >= 0 && <img className="game-c-countdown pop"
      src={[IMG.count3, IMG.count2, IMG.count1, IMG.countStart][countdown]} alt={['3', '2', '1', '시작'][countdown]} />}
    {finishing && <>
      {riceComplete ? <RiceCake style={{ left: 710, top: 310, width: 500, height: 333 }} />
        : <img src={GAME_C_IMAGES.dough[3]} alt="만들고 있던 떡 반죽" style={{ position: 'absolute', left: 710, top: 310, width: 500, height: 333, objectFit: 'contain' }} />}
      <GameCRabbit rabbit={rabbits.p1} side={1} pose="idle" style={{ left: 180, top: 330, width: 580, height: 435 }} />
      <GameCRabbit rabbit={rabbits.p2} side={2} pose="idle" style={{ left: 1160, top: 330, width: 580, height: 435 }} />
      <p className="game-c-finish-score">{score}점</p>
      <p className="game-c-guide">{stage === 'finish' ? '두 사람 모두 양팔을\n머리 위로 들어주세요' : '함께 만든 결과를 확인해볼까요?'}</p>
      {stage === 'finish' && <div className="game-c-finish-progress"><div style={{ width: `${finishProgress * 100}%` }} /></div>}
    </>}
    {['practice', 'play', 'finish'].includes(stage) && <p className="voice-status" role="status">{responseOpen ? '지금 동작해 주세요' : '안내를 듣고 준비해 주세요'}</p>}
    {armed && <p className="game-staff-notice" role="status">중단하려면 2를 한 번 더 눌러 주세요</p>}
    </div>}
    {(stage === 'fadeOut' || stage === 'fadeIn') && <div key={stage} className={`fill game-c-blackout ${stage}`} onAnimationEnd={event => {
      if (clock.paused) return
      if (event.target !== event.currentTarget) return
      if (stage === 'fadeOut' && event.animationName === 'gameCToBlack') { setStage('fadeIn') }
      if (stage === 'fadeIn' && event.animationName === 'gameCFromBlack') setStage('backgroundHold')
    }} />}
    {stage !== 'end' && <GamePause paused={paused} onPause={pause} onResume={() => void resume()}>
      <p>{keyboardOnly ? '키보드 모드' : '카메라 모드'}</p>
      {poseEngine.cameraOk && !riceGripEngine.error && <button className="pixel-btn secondary" onClick={() => {
        keys.current.clear()
        setForceKeyboard(value => !value)
      }}>{forceKeyboard ? '카메라로 전환' : '키보드로 전환'}</button>}
      <p>1P: Q 왼손 · W 오른손 · E 잼잼</p>
      <p>2P: O 왼손 · P 오른손 · I 잼잼</p>
      <p>떡 치기: 양손 키를 함께 누른 뒤 놓기</p>
      <p>잼잼: 키를 눌렀다 놓기 × 3</p>
      <p>1 연습 건너뛰기 · 2 두 번 눌러 중단</p>
      {riceGripEngine.error && <p>손가락 인식을 시작하지 못해 키보드 모드로 전환했습니다.</p>}
    </GamePause>}
  </div>
}
