import { useEffect, useRef, useState } from 'react'
import { IMG } from '../assets'
import { GAME_D_IMAGES, preloadGameD } from '../game/gameDAssets'
import { GAME_D_RULES, SHOPPING_LEVELS, ShoppingGripTracker, ShoppingSession,
  type GameDResult, type ShoppingGrip, type ShoppingLevel, type Shoppers } from '../game/gameD'
import { shoppingGripEngine } from '../game/gameDGrip'
import { poseEngine } from '../game/pose'
import { COUNTDOWN_CUES, COUNTDOWN_TOTAL_MS, beep, goodChime, runNarration } from '../game/audio'
import { SHOPPING_VOICE_TEXT, shoppingFeedbackVoice, type ShoppingVoiceKey } from '../game/gameDVoice'
import { playBgm, stopBgm } from '../game/bgm'
import type { PlayerId } from '../game/types'
import { GameDBoard, type ShoppingFeedback } from '../components/GameDBoard'
import { GamePause } from '../components/GamePause'
import { ShoppingPractice } from '../game/gameDPractice'
import './gameD.css'

type Stage = 'loading' | 'ready' | 'practice' | 'starting' | 'countdown' | 'play' | 'end'
const emptyGrips = (): Record<PlayerId, ShoppingGrip> => ({ 1: 'unknown', 2: 'unknown' })

export function GameDScreen({ shoppers, skipPractice = false, onFinish, onExit }: {
  shoppers: Shoppers; skipPractice?: boolean; onFinish: (result: GameDResult) => void; onExit: () => void
}) {
  const [stage, setStage] = useState<Stage>('loading')
  const [level, setLevel] = useState<ShoppingLevel>(1)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [forceKeyboard, setForceKeyboard] = useState(false)
  const [keyboard, setKeyboard] = useState(false)
  const [grips, setGrips] = useState(emptyGrips)
  const [practice, setPractice] = useState<Record<PlayerId, number>>({ 1: 0, 2: 0 })
  const practiceRef = useRef<Record<PlayerId, number>>({ 1: 0, 2: 0 })
  const rehearsal = useRef(new ShoppingPractice())
  const [countdown, setCountdown] = useState(0)
  const countdownMs = useRef(0)
  const session = useRef<ShoppingSession | null>(null)
  const trackers = useRef({ 1: new ShoppingGripTracker(), 2: new ShoppingGripTracker() })
  const keys = useRef(new Set<string>())
  const pulse = useRef<Record<PlayerId, number>>({ 1: 0, 2: 0 })
  const [feedback, setFeedback] = useState<ShoppingFeedback[]>([])
  const feedbackRef = useRef<ShoppingFeedback[]>([])
  const feedbackId = useRef(0)
  const [, redraw] = useState(0)
  const finishRef = useRef(onFinish)
  finishRef.current = onFinish
  const endResult = useRef<GameDResult | null>(null)
  const [guidanceOpen, setGuidanceOpen] = useState(false)
  const guidanceOpenRef = useRef(false)
  const [voiceText, setVoiceText] = useState('')
  const activeGuidance = useRef<(() => void) | null>(null)
  const feedbackVoice = useRef<(() => void) | null>(null)
  const feedbackBusy = useRef(false)
  const feedbackAfter = useRef(0)
  const resumeRequested = useRef(false)
  const current = session.current
  const tutorial = ['ready', 'practice', 'starting'].includes(stage)
  const closeGuidance = () => { guidanceOpenRef.current = false; setGuidanceOpen(false) }
  const cancelFeedback = () => {
    feedbackVoice.current?.(); feedbackVoice.current = null; feedbackBusy.current = false
  }
  const resetInput = () => {
    keys.current.clear(); pulse.current = { 1: 0, 2: 0 }
    trackers.current[1].reset(); trackers.current[2].reset(); shoppingGripEngine.reset()
  }
  const pause = () => {
    activeGuidance.current?.(); cancelFeedback(); closeGuidance()
    pausedRef.current = true; setPaused(true); resetInput()
  }
  const resume = () => {
    resumeRequested.current = true; closeGuidance()
    resetInput(); pausedRef.current = false; setPaused(false)
  }

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    preloadGameD().then(() => { if (!cancelled) setStage('ready') })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [attempt])
  useEffect(() => {
    if (!paused && (stage === 'ready' || stage === 'practice')) playBgm('tutorial', .18)
    else stopBgm()
    return () => stopBgm()
  }, [stage, paused])
  useEffect(() => () => shoppingGripEngine.reset(), [])
  useEffect(() => {
    cancelFeedback(); closeGuidance(); setVoiceText('')
    if (paused || stage === 'loading') return
    const key: ShoppingVoiceKey | null = resumeRequested.current && stage !== 'ready' ? 'd_resume'
      : stage === 'ready' ? 'd_rules' : stage === 'practice' ? 'd_practice'
      : stage === 'starting' ? 'd_start'
      : stage === 'end' ? (endResult.current?.reason === 'success' ? 'd_success' : 'd_timeout') : null
    resumeRequested.current = false
    const complete = () => {
      resetInput(); setVoiceText('')
      if (stage === 'end') { if (endResult.current) finishRef.current(endResult.current); return }
      guidanceOpenRef.current = true; setGuidanceOpen(true)
      if (stage === 'starting') setStage('countdown')
    }
    if (!key) { complete(); return cancelFeedback }
    setVoiceText(SHOPPING_VOICE_TEXT[key])
    const cancel = runNarration(key, complete, stage === 'end' ? 2100 : 0)
    activeGuidance.current = cancel
    return () => { cancel(); cancelFeedback(); guidanceOpenRef.current = false }
  }, [stage, paused])
  useEffect(() => {
    const clear = () => { if (['ready', 'practice', 'starting', 'countdown', 'play'].includes(stage)) pause(); else resetInput() }
    const hidden = () => { if (document.hidden) clear() }
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey || target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
      if (e.code === 'Digit1' && !e.repeat && stage === 'practice' && !pausedRef.current) { start(); return }
      if (e.code === 'Escape' && !e.repeat && ['ready', 'practice', 'starting', 'countdown', 'play'].includes(stage)) {
        pausedRef.current ? resume() : pause()
        return
      }
      const key = e.code === 'KeyE' ? 'e' : e.code === 'KeyI' ? 'i' : null
      if (!key || !keyboard || pausedRef.current || !guidanceOpenRef.current || !['practice', 'play'].includes(stage)) return
      e.preventDefault()
      if (!e.repeat) {
        keys.current.add(key)
        pulse.current[key === 'e' ? 1 : 2] = performance.now() + 220
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code === 'KeyE' ? 'e' : e.code === 'KeyI' ? 'i' : '')
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', hidden)
    }
  }, [stage, keyboard])

  useEffect(() => {
    let last = performance.now()
    let previousMode: boolean | null = null
    let previousHandReady = forceKeyboard || (poseEngine.ready && !poseEngine.cameraOk) ||
      Boolean(shoppingGripEngine.error) || shoppingGripEngine.ready
    let lastCountdown = -1
    const timer = window.setInterval(() => {
      const now = performance.now()
      let dt = now - last
      last = now
      if (!forceKeyboard && poseEngine.cameraOk && !shoppingGripEngine.ready && !shoppingGripEngine.error)
        void shoppingGripEngine.init()
      const kb = forceKeyboard || (poseEngine.ready && !poseEngine.cameraOk) || Boolean(shoppingGripEngine.error)
      setKeyboard(kb)
      if (previousMode !== kb) { resetInput(); previousMode = kb }
      if (pausedRef.current || stage === 'loading' || stage === 'end') return
      const handReady = kb || shoppingGripEngine.ready
      if (!handReady) { previousHandReady = false; setGrips(emptyGrips()); return }
      // Model loading/warmup must not consume the countdown or trigger a stall pause.
      if (!previousHandReady) dt = 0
      previousHandReady = true
      if (dt > 800 && ['ready', 'practice', 'starting', 'countdown', 'play'].includes(stage)) { pause(); return }
      const sample = kb ? { grips: {
        1: keys.current.has('e') || now < pulse.current[1] ? 'closed' : 'open',
        2: keys.current.has('i') || now < pulse.current[2] ? 'closed' : 'open',
      } as Record<PlayerId, ShoppingGrip>, at: now } : shoppingGripEngine.sample(now)
      if (!kb) for (const pid of [1, 2] as const)
        if (!poseEngine.getPose(pid).present) sample.grips[pid] = 'unknown'
      setGrips({ ...sample.grips })
      if (!guidanceOpenRef.current) return
      if (stage === 'countdown') {
        countdownMs.current += dt
        const count = COUNTDOWN_CUES.reduce((index, cue, i) => countdownMs.current >= cue ? i : index, 0)
        setCountdown(count)
        if (count !== lastCountdown) { beep(count === 3 ? 1320 : 880, 150); lastCountdown = count }
        if (countdownMs.current >= COUNTDOWN_TOTAL_MS) {
          resetInput()
          session.current = new ShoppingSession(level)
          session.current.noteMode(kb ? 'keyboard' : 'camera')
          setStage('play')
        }
        return
      }
      if (stage !== 'practice' && stage !== 'play') return
      if (stage === 'practice') rehearsal.current.advance(dt)
      const run = session.current
      if (stage === 'play' && run) { run.noteMode(kb ? 'keyboard' : 'camera'); run.advance(dt) }
      const nextFeedback = feedbackRef.current.filter(f => now < f.until)
      for (const pid of [1, 2] as const) {
        const accepted = trackers.current[pid].update(sample.grips[pid], sample.at)
        if (!accepted) continue
        if (stage === 'practice') {
          const item = rehearsal.current.pick(pid)
          if (item) {
            practiceRef.current = { ...rehearsal.current.collected }
            setPractice({ ...practiceRef.current })
            nextFeedback.push({ player: pid, itemId: item.id, product: item.product, outcome: 'correct',
              atMs: rehearsal.current.elapsedMs, reactionMs: null, id: ++feedbackId.current,
              until: now + 2000, fromY: item.y - 113 })
            goodChime()
          }
        } else if (run) {
          const item = run.items.find(i => i.player === pid && i.y >= GAME_D_RULES.zoneStart && i.y <= GAME_D_RULES.zoneEnd)
          const event = run.pick(pid)
          if (event) {
            nextFeedback.push({ ...event, id: ++feedbackId.current, until: now + 2000, fromY: (item?.y ?? 948) - 113 })
            if (event.outcome === 'correct') goodChime()
            else beep(220, 130, .06)
            // Feedback does not pause the 120-second session or queue stale messages.
            // Two simultaneous picks share one voice; all visual feedback still appears.
            if (!run.reason && !feedbackBusy.current && now >= feedbackAfter.current) {
              feedbackBusy.current = true; feedbackAfter.current = now + 6000
              feedbackVoice.current = runNarration(shoppingFeedbackVoice(event), () => { feedbackBusy.current = false })
            }
          }
        }
      }
      feedbackRef.current = nextFeedback; setFeedback(nextFeedback)
      redraw(n => n + 1)
      if (stage === 'play' && run?.reason) {
        endResult.current = run.finish()
        resetInput(); closeGuidance(); setStage('end')
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [stage, level, forceKeyboard])

  const start = () => {
    if (pausedRef.current) return
    resetInput(); closeGuidance(); feedbackRef.current = []; setFeedback([]); countdownMs.current = 0; setCountdown(0); setStage('starting')
  }
  const practiceDone = practice[1] >= 2 && practice[2] >= 2
  const beginPractice = () => {
    if (pausedRef.current) return
    resetInput(); closeGuidance(); rehearsal.current = new ShoppingPractice(); feedbackRef.current = []; setFeedback([]); practiceRef.current = { 1: 0, 2: 0 }; setPractice({ 1: 0, 2: 0 }); setStage('practice')
  }
  const modeControl = <div className="shopping-mode">
    <span>{keyboard ? '키보드 모드 · 왼쪽 E / 오른쪽 I' : shoppingGripEngine.ready ? '카메라 모드 · 두 손을 보여 주세요' : '카메라 준비 중…'}</span>
    {(forceKeyboard || !((poseEngine.ready && !poseEngine.cameraOk) || shoppingGripEngine.error)) &&
      <button className="pixel-btn secondary" onClick={() => { resetInput(); setForceKeyboard(v => !v) }}>
        {forceKeyboard ? '카메라로 전환' : '키보드로 전환'}
      </button>}
    {shoppingGripEngine.error && <span>손 인식을 시작하지 못해 키보드 모드를 사용합니다.</span>}
  </div>
  const remaining = Math.ceil((GAME_D_RULES.durationMs - (current?.elapsedMs ?? 0)) / 1000)
  const onAbort = () => {
    if (current) { resetInput(); finishRef.current(current.finish('aborted')) }
    else onExit()
  }
  return <div className="fill shopping-game" data-game="shopping" data-stage={stage} data-paused={paused} data-response-open={guidanceOpen && !paused}>
    <img src={tutorial ? IMG.tutBg : GAME_D_IMAGES.background} alt="" className={tutorial ? 'fill shopping-tutorial-background' : 'shopping-background'} />
    {(['countdown', 'play', 'end'].includes(stage)) && <GameDBoard current={current} level={level}
      remaining={remaining} shoppers={shoppers} grips={grips} feedback={feedback} keyboard={keyboard} tracking={stage === 'play'} />}
    {stage === 'loading' && <div className="shopping-overlay"><section className="shopping-dialog"><h1>협동 장보기</h1>
      <p>{loadError ? '그림을 불러오지 못했어요.' : '장을 볼 준비를 하고 있어요…'}</p>
      {loadError && <button className="pixel-btn" onClick={() => setAttempt(n => n + 1)}>다시 불러오기</button>}
      <button className="pixel-btn secondary" onClick={onExit}>마을로</button>
    </section></div>}
    {tutorial && <section key={stage} className="fill shopping-tutorial fade-in" aria-label="장보기 안내"
      aria-hidden={paused} ref={element => { if (element) element.inert = paused }}>
      <h1 className="shopping-tutorial-title">{stage === 'ready' ? '협동 장보기' : stage === 'starting' || practiceDone ? '잘하셨어요' : '잼잼 연습'}</h1>
      <p className="shopping-tutorial-guide">{stage === 'ready'
        ? <>120초 안에 목록의 물건을 함께 담아요<span>물건이 초록 칸에 오면 양손을 쥐어 주세요</span></>
        : stage === 'starting' || practiceDone
        ? <>이제 장보기를 시작해 볼까요?<span>양손을 활짝 펴고 준비해 주세요</span></>
        : <>양팔을 앞으로 뻗고 손을 활짝 펴 주세요<span>사과가 초록 칸에 오면 양손을 함께 쥐어 주세요</span></>}</p>
      <div className="shopping-tutorial-game" aria-label="장보기 연습 게임 화면">
        <GameDBoard current={rehearsal.current} level={level} remaining={120} shoppers={shoppers}
          grips={stage === 'practice' ? grips : emptyGrips()} feedback={feedback} keyboard={keyboard} practice={practice} />
      </div>
      {(stage === 'ready' || stage === 'practice' && practiceDone) && <button className="pixel-btn shopping-tutorial-next" disabled={paused || !guidanceOpen || (stage === 'practice' && !practiceDone)}
        onClick={stage === 'ready' && !skipPractice ? beginPractice : start}>{stage === 'ready' && !skipPractice ? '잼잼 연습하기' : '장보기 시작'}</button>}
      <p className="voice-status" role="status">{!guidanceOpen ? '안내를 듣고 준비해 주세요'
        : stage === 'practice' && !practiceDone ? '지금 동작해 주세요' : '준비되면 시작해 주세요'}</p>
      {stage === 'practice' && !practiceDone && <p className="shopping-practice-note">
        {keyboard ? '왼쪽 E · 오른쪽 I — 한 번 누르고 놓아 주세요' : '담은 뒤에는 양손을 다시 활짝 펴 주세요'}
      </p>}
    </section>}
    {stage === 'countdown' && <img key={countdown} className="shopping-countdown pop"
      src={[IMG.count3, IMG.count2, IMG.count1, IMG.countStart][countdown]} alt={['3', '2', '1', '시작'][countdown]} />}
    {stage === 'end' && <div className="shopping-end" role="status">{current?.reason === 'success' ? '목록을 모두 채웠어요!' : '장보기 시간이 끝났어요'}</div>}
    {voiceText && !paused && !tutorial && <div className="shopping-voice" role="status"><strong>안내를 듣고 준비해 주세요</strong><p>{voiceText}</p></div>}
    {stage !== 'loading' && stage !== 'end' && <GamePause paused={paused} onPause={pause} onResume={resume}>
      {stage === 'ready' && <label className="shopping-level-setting">난이도
        <select aria-label="장보기 난이도" value={level} onChange={event => setLevel(Number(event.target.value) as ShoppingLevel)}>
          {([1, 2, 3] as const).map(n => <option key={n} value={n}>{SHOPPING_LEVELS[n].label} · 목록 {SHOPPING_LEVELS[n].types}종</option>)}
        </select>
      </label>}
      {modeControl}
      <p>왼쪽 E · 오른쪽 I: 양손 잼잼</p>
      <p>1: 연습 건너뛰기</p>
      <p>기본자세: 양팔을 앞으로 뻗고 손 펴기</p>
      <button className="pixel-btn secondary" onClick={onAbort}>{current ? '여기까지 결과 보기' : '마을로'}</button>
    </GamePause>}

  </div>
}
