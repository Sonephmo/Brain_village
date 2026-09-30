// Production audio and game screens with controlled time/input. No camera or backend writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replaceAll('import.meta.env', JSON.stringify({ BASE_URL: '/', DEV: false }))
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, console, ...globals,
    require: id => { assert.ok(id in dependencies, `Unexpected import ${id}`); return dependencies[id] },
  }, { filename: file })
  return exports
}
const settle = () => new Promise(resolve => setImmediate(resolve))
const checks = []
class Clock {
  now = 100
  id = 0
  jobs = new Map()
  listeners = new Map()
  changed = () => {}
  setTimeout = (fn, ms = 0) => { const id = ++this.id; this.jobs.set(id, { fn, at: this.now + ms }); return id }
  clearTimeout = id => { this.jobs.delete(id) }
  setInterval = (fn, ms) => { const id = ++this.id; this.jobs.set(id, { fn, at: this.now + ms, ms }); return id }
  clearInterval = this.clearTimeout
  addEventListener = (type, fn) => { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn) }
  removeEventListener = (type, fn) => this.listeners.get(type)?.delete(fn)
  matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  event(type, key) { for (const fn of [...this.listeners.get(type) ?? []]) fn(typeof key === 'object' ? key : { key, repeat: false, preventDefault() {} }); this.changed() }
  advance(ms) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      const [id, job] = next
      this.now = job.at
      if (job.ms) job.at += job.ms
      else this.jobs.delete(id)
      job.fn(); this.changed()
    }
    this.now = end; this.changed()
  }
  globals() { return { window: this, performance: { now: () => this.now }, setTimeout: this.setTimeout, clearTimeout: this.clearTimeout } }
}

function audioFixture({ missing = false, suspended = false, unavailable = false, slow = false } = {}) {
  const clock = new Clock(), sources = [], gains = []
  const buffer = { duration: 2, sampleRate: 10, getChannelData: () => new Float32Array(20).fill(.5) }
  let release
  const gate = slow ? new Promise(resolve => { release = resolve }) : Promise.resolve()
  class AudioContext {
    constructor() { if (unavailable) throw new Error('Unsupported') }
    state = suspended ? 'suspended' : 'running'
    currentTime = 0
    destination = {}
    suspend = async () => { this.state = 'suspended' }
    resume = async () => { if (suspended) throw new Error('Autoplay blocked'); this.state = 'running' }
    decodeAudioData = async () => buffer
    createBufferSource() {
      const source = { onended: null, stops: 0, disconnects: 0,
        connect: target => target,
        start(...args) { this.started = args },
        stop() { this.stops++ }, disconnect() { this.disconnects++ },
        end() { this.onended?.() },
      }
      sources.push(source); return source
    }
    createGain() { const gain = { gain: { value: 0 }, connect: target => target, disconnect() {} }; gains.push(gain); return gain }
  }
  const api = load('src/game/audio.ts', { './gameClock': load('src/game/gameClock.ts', {}, clock.globals()) }, { ...clock.globals(), AudioContext,
    fetch: async () => { await gate; return { ok: !missing, arrayBuffer: async () => new ArrayBuffer(0) } },
  })
  return { api, clock, sources, gains, release }
}

{
  const { api, clock, sources, gains } = audioFixture()
  await api.initAudio()
  let ends = 0
  api.runNarration('c_cue_pound', () => ends++)
  await settle()
  assert.deepEqual(sources[0].started, [0, 0, 2], 'New guidance plays the complete original buffer')
  assert.equal(gains[0].gain.value, 1)
  clock.advance(2100)
  assert.equal(ends, 0, 'Estimated duration alone cannot open the response window')
  sources[0].end()
  assert.equal(ends, 1)
  clock.advance(10000)
  assert.equal(ends, 1)
  api.runNarration('c_swap', () => ends++, 4000)
  await settle(); sources.at(-1).end(); clock.advance(3999)
  assert.equal(ends, 1)
  clock.advance(1); assert.equal(ends, 2, 'Role swap retains its four-second reading floor')
  checks.push('Narration: original audio, real end event, single callback and minimum role-swap time')
}
{
  const { api, clock, sources } = audioFixture()
  await api.initAudio()
  let ends = 0
  const cancelOld = api.runNarration('b_practice_left', () => ends++)
  await settle()
  api.runNarration('b_practice_right', () => ends++)
  await settle(); cancelOld()
  assert.equal(sources[0].stops, 1)
  assert.equal(sources[1].stops, 0, 'Old screen cleanup must not cancel the new narration')
  api.stopNarration(); sources.forEach(s => s.end()); clock.advance(20000)
  assert.equal(ends, 0)
  api.playCountdown(); const first = sources.at(-1)
  api.playCountdown(); assert.equal(first.stops, 1)
  api.stopCountdown(); assert.equal(sources.at(-1).stops, 1)
  checks.push('Cleanup: replacement, stale cleanup, exit and countdown restart stop owned audio')
}
{
  const { api, clock, sources, release } = audioFixture({ slow: true })
  let ends = 0
  const cancel = api.runNarration('b_practice_right', () => ends++)
  cancel(); release(); await settle(); clock.advance(30000)
  assert.equal(sources.length, 0); assert.equal(ends, 0)
  const waiting = audioFixture({ slow: true })
  waiting.api.runNarration('b_stop', () => ends++)
  waiting.clock.advance(4000 + 2489); assert.equal(ends, 0)
  waiting.clock.advance(1); assert.equal(ends, 1)
  waiting.release(); await settle(); assert.equal(waiting.sources.length, 0)
  checks.push('Loading: cancelled or timed-out fetch cannot start late audio; offline progress remains possible')
}
for (const mode of ['missing', 'suspended', 'unavailable']) {
  const { api, clock } = audioFixture({ [mode]: true })
  let ended = false
  api.runNarration('c_practice_squeeze', () => { ended = true })
  await settle(); clock.advance(3919); assert.equal(ended, false)
  clock.advance(1); assert.equal(ended, true)
}
{
  const { api, clock, sources } = audioFixture()
  let ends = 0
  api.runNarration('c_finish', () => ends++)
  await settle(); clock.advance(3500)
  assert.equal(ends, 1); assert.ok(sources[0].stops >= 1)
  checks.push('Fallback: missing file, blocked autoplay, unsupported audio and stalled audio clock terminate safely')
}

const rest = { present: true, handsTracked: true, leftRaised: false, rightRaised: false }
{
  const clock = new Clock(), instructions = []
  let words = 0
  const { GameRunner } = load('src/game/engine.ts', {
    './pose': { poseEngine: { getPose: () => ({ ...rest, leftRaised: true }) } },
    './audio': { speakCommand() { words++ }, stopSpeech() {}, playSfx() {}, neutralTick() {}, transitionChime() {} },
  }, { ...clock.globals(), requestAnimationFrame: () => 0, cancelAnimationFrame() {} })
  const { PRACTICE } = load('src/game/commands.ts')
  const runner = new GameRunner({ commands: [PRACTICE[2], PRACTICE[2]], scored: false, waitForSuccess: true,
    onSnapshot() {}, onFinish() {}, practiceNarration: (_, end) => {
      const voice = { end, cancelled: false }; instructions.push(voice); return () => { voice.cancelled = true }
    },
  })
  runner.start(); clock.advance(10000)
  assert.equal(runner.phase, 'speak'); assert.equal(words, 0)
  instructions[0].end(10000); clock.advance(800)
  assert.equal(runner.phase, 'feedback')
  clock.advance(1000); assert.equal(runner.phase, 'speak')
  instructions[0].end(10000); assert.equal(runner.phase, 'speak', 'Prior cue callbacks are ignored')
  runner.skipCurrent(); assert.equal(instructions[1].cancelled, true)
  instructions[1].end(1000); assert.equal(runner.phase, 'feedback')
  runner.stop(); clock.advance(10000)
  assert.equal(runner.logs.length, 0, 'Practice skipping does not create scored trials')
  checks.push('A: practice waits for narration, avoids duplicate word clips, ignores stale callbacks and cancels skip')
}

// Minimal React hook driver: executes real screen effects/callbacks, batches state updates,
// and represents JSX as inspectable data. Rendering and real audio are covered by browser smoke checks.
function hooks(clock) {
  const slots = [], effects = []; let cursor = 0, dirty = false, mounted = true, render, tree
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { if (!mounted) return; const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(slots[i], next)) { slots[i] = next; dirty = true } }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]
      if (!old || !deps || deps.some((d, index) => !Object.is(d, old.deps[index]))) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } })
      } },
  }
  const flush = () => {
    let guard = 0
    while (dirty) { assert.ok(++guard < 100, 'Render loop'); dirty = false; cursor = 0; tree = render(); effects.splice(0).forEach(fn => fn()) }
  }
  clock.changed = flush
  return { react, jsx: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    mount(fn) { render = fn; dirty = true; flush() }, flush, get tree() { return tree },
    unmount() { mounted = false; slots.forEach(s => s?.cleanup?.()) },
  }
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)] }
function screenFixture(game, skipPractice = true) {
  const clock = new Clock(), h = hooks(clock), voices = [], results = [], starts = [], trials = [], runners = []
  const { GameClock } = load('src/game/gameClock.ts', {}, clock.globals())
  const voiceClock = new GameClock()
  let cancelSpeech = () => {}
  const poses = [{ ...rest }, { ...rest }]
  const gameB = load('src/game/gameB.ts'), gameC = load('src/game/gameC.ts')
  const dummy = () => null
  const audio = { COUNTDOWN_CUES: [0, 925, 1831, 2770], COUNTDOWN_TOTAL_MS: 3162,
    playCountdown() {}, stopCountdown() {}, beep() {}, goodChime() {}, playSfx() {},
    pauseGameAudio() { voiceClock.pause() }, async resumeGameAudio() { voiceClock.resume() },
    speakCommand(words, text, fake, end) { cancelSpeech = audio.runNarration('a_command', () => end(1000)) },
    stopSpeech() { cancelSpeech() }, neutralTick() {}, transitionChime() {},
    runNarration(key, end, minimumMs = 0) {
      const voice = { key, minimumMs, cancelled: false, end() {
        const complete = () => { if (!voice.cancelled) { end(); h.flush() } }
        if (voiceClock.paused) voiceClock.setTimeout(complete, 0); else complete()
      } }
      voices.push(voice); return () => { voice.cancelled = true }
    },
  }
  const gameD = load('src/game/gameD.ts', { './gameDCatalog': load('src/game/gameDCatalog.ts'), './handGrip': load('src/game/handGrip.ts') })
  const sessions = []
  class TrackedShoppingSession extends gameD.ShoppingSession {
    constructor(level) { super(level, () => .1); sessions.push(this) }
  }
  const deps = { react: h.react, 'react/jsx-runtime': h.jsx,
    '../components/GameBAvatar': { GameBAvatar: dummy }, '../components/Sprite': { Sprite: dummy },
    '../components/GameCRabbit': { GameCRabbit: dummy, RiceCake: dummy },
    '../components/GameCEffect': { GameCEffect: dummy }, '../components/GameCMoonScore': { GameCMoonScore: dummy },
    '../components/GameTimer': { GameTimer: 'timer' },
    '../components/GamePause': { GamePause: 'pause' },
    '../components/GameDBoard': { GameDBoard: 'shopping-board' },
    '../game/gameDPractice': load('src/game/gameDPractice.ts', { './gameD': gameD }),
    '../components/GameDArt': { GameDArt: dummy }, '../components/GameDShopper': { GameDShopper: dummy },
    '../assets': { FX: {}, IMG: {}, frameSize: () => ({}) },
    '../components/Avatar': { Avatar: dummy, poseFromHands: () => 'stand' },
    '../components/CameraPanel': { CameraPanel: dummy },
    '../game/commands': load('src/game/commands.ts'),
    '../game/logging': { APP_VERSION: 'test' },
    '../game/telemetry': { CONTENT_ID: 'test', startSession: info => starts.push(info), logCommand: log => trials.push(log), logRoleSwap() {}, endSession() {} },
    '../game/motion': { motionSampler: { start() {}, stop() {} } }, '../game/audio': audio, '../game/bgm': { playBgm() {}, stopBgm() {}, setBgmPaused() {} },
    '../game/pose': { poseEngine: { ready: true, cameraOk: false, getPose: pid => poses[pid - 1], setKeyboardPaused() {}, status: () => ({ cameraOk: false, keyboardMode: true, fps: 20 }) } },
    '../game/gameB': gameB, '../game/gameC': gameC,
    '../game/gameCGrip': { riceGripEngine: { ready: true, error: null, init: async () => {}, reset() {}, sample: () => 'unknown' } },
    '../game/gameBAssets': { GAME_B_IMAGES: {}, FIRE_FRAMES: {}, preloadGameB: async () => {} },
    '../game/gameCAssets': { GAME_C_IMAGES: { dough: [] }, preloadGameC: async () => {} },
    '../game/gameD': { ...gameD, ShoppingSession: TrackedShoppingSession },
    '../game/gameDVoice': load('src/game/gameDVoice.ts'),
    '../game/gameDAssets': { GAME_D_IMAGES: {}, preloadGameD: async () => {} },
    '../game/gameDGrip': { shoppingGripEngine: { reset() {}, ready: true, error: null } },
    './gameD.css': {},
  }
  const doc = { hidden: false, addEventListener: clock.addEventListener, removeEventListener: clock.removeEventListener }
  deps['../game/useGamePause'] = load('src/game/useGamePause.ts', {
    react: h.react, './gameClock': load('src/game/gameClock.ts', {}, clock.globals()),
    './audio': audio, './bgm': deps['../game/bgm'], './pose': deps['../game/pose'],
  }, { ...clock.globals(), document: doc })
  const Runner = load('src/game/engine.ts', { './audio': audio, './pose': deps['../game/pose'] }, { ...clock.globals(), requestAnimationFrame: () => 0, cancelAnimationFrame() {} }).GameRunner
  deps['../game/engine'] = { GameRunner: class extends Runner { constructor(options) { super(options); runners.push(this) } } }
  const Component = load(`src/screens/Game${game === 'A' ? '' : game}Screen.tsx`, deps, { ...clock.globals(), document: doc })[`Game${game === 'A' ? '' : game}Screen`]
  h.mount(() => Component({ avatars: { p1: 'grandma', p2: 'grandfa' }, rabbits: { p1: 'pink', p2: 'brown' }, skipPractice,
    shoppers: { p1: 'male', p2: 'female' },
    onExit() {}, onFinish: (result, score, session) => results.push(game === 'A' ? { logs: result, score, session } : result),
  }))
  return { clock, h, voices, results, poses, gameC, sessions, doc, starts, trials, runners, deps,
    pause: () => { nodes(h.tree).find(n => n.type === 'pause').props.onPause(); h.flush() },
    resume: async () => { nodes(h.tree).find(n => n.type === 'pause').props.onResume(); await settle(); clock.advance(0); h.flush() },
    stage: () => h.tree.props[game === 'D' ? 'data-stage' : `data-game-${game.toLowerCase()}-stage`],
    open: () => h.tree.props['data-response-open'],
    timer: () => game === 'D' ? nodes(h.tree).find(n => n.type === 'shopping-board')?.props.remaining : nodes(h.tree).find(n => n.type === 'timer')?.props.value,
    animation(name) { const node = nodes(h.tree).find(n => n.props.onAnimationEnd &&
      (game === 'A' || game === 'B' || name === 'gameCFromBlack' && n.props.className?.includes('blackout') ||
       name === 'gameCBackgroundFocus' && n.props.className === 'game-c-play-background' ||
       name === 'sceneUiDissolve' && n.props.className?.includes('scene-ui-dissolve')))
      assert.ok(node, `Animation ${name}`); const target = {}; node.props.onAnimationEnd({ target, currentTarget: target, animationName: name }); h.flush() },
  }
}
async function startMain(f, game) {
  await settle(); f.h.flush()
  f.animation(game === 'B' ? 'gameFadeIn' : 'gameCFromBlack')
  if (game === 'C') { f.clock.advance(3000); f.animation('gameCBackgroundFocus'); f.animation('sceneUiDissolve') }
  f.clock.advance(3162)
  assert.equal(f.stage(), game === 'B' ? 'main' : 'play')
}
{
  const f = screenFixture('B'); await startMain(f, 'B')
  for (let i = 0; i < 10; i++) {
    assert.equal(f.open(), false); assert.equal(f.timer(), 60 - i * 6)
    f.clock.advance(10000)
    assert.equal(f.timer(), 60 - i * 6, 'Narration must consume no action time')
    assert.equal(f.h.tree.props['data-event-index'], i)
    f.voices.at(-1).end(); assert.equal(f.open(), true)
    f.clock.advance(5950); assert.equal(f.h.tree.props['data-event-index'], i)
    f.clock.advance(50)
  }
  assert.equal(f.stage(), 'end'); f.clock.advance(1800)
  assert.equal(f.results.length, 1); assert.equal(f.results[0].events.length, 10)
  assert.equal(f.results[0].completed, true)
  f.h.unmount()
  const abort = screenFixture('B'); await startMain(abort, 'B')
  const voice = abort.voices.at(-1)
  abort.clock.event('keydown', '2'); abort.clock.event('keydown', '2')
  assert.equal(voice.cancelled, true)
  abort.h.unmount(); abort.clock.advance(20000)
  assert.equal(abort.results.length, 0, 'Exit cancels delayed results as well as narration')
  checks.push('B: all ten cues retain six seconds after voice; narration freezes timer; abort and unmount cancel work')
}
{
  const f = screenFixture('C'); await startMain(f, 'C')
  for (let i = 0; i < 20; i++) {
    assert.equal(f.stage(), 'play'); assert.equal(f.open(), false)
    assert.equal(f.timer(), 80 - i * 4)
    f.clock.advance(10000); assert.equal(f.stage(), 'play'); assert.equal(f.timer(), 80 - i * 4)
    f.voices.at(-1).end(); assert.equal(f.open(), true)
    f.clock.advance(2950); assert.equal(f.stage(), 'play')
    f.clock.advance(50); assert.equal(f.stage(), 'feedback')
    f.clock.advance(1000)
    if (i === 9) {
      assert.equal(f.stage(), 'swap'); assert.equal(f.voices.at(-1).key, 'c_swap'); assert.equal(f.voices.at(-1).minimumMs, 4000)
      f.clock.advance(4000); f.voices.at(-1).end()
    }
  }
  assert.equal(f.stage(), 'end'); assert.ok(!f.voices.some(v => v.key === 'c_finish'))
  f.clock.advance(1600); assert.equal(f.results[0].trials.length, 20); assert.equal(f.results[0].score, 0)
  assert.equal(f.results[0].finishPoseCompleted, false)
  f.h.unmount()
  checks.push('C: all twenty cues retain three seconds after voice; role swap is voiced; low score never adds finish pose')
}
{
  const f = screenFixture('C', false); await settle(); f.h.flush()
  // Complete a full motion during narration: it must neither pass practice nor seed the next gesture.
  f.clock.advance(200); f.clock.event('keydown', 'q'); f.clock.event('keydown', 'w'); f.clock.advance(200)
  f.clock.event('keyup', 'q'); f.clock.event('keyup', 'w'); f.clock.advance(200)
  assert.equal(f.stage(), 'practice')
  f.voices.at(-1).end(); f.clock.advance(200); assert.equal(f.stage(), 'practice')
  f.clock.event('keydown', 'q'); f.clock.event('keydown', 'w'); f.clock.advance(200)
  f.clock.event('keyup', 'q'); f.clock.event('keyup', 'w'); f.clock.advance(200)
  assert.equal(f.stage(), 'practiceFeedback')
  f.clock.advance(900); assert.equal(f.voices.at(-1).key, 'c_practice_squeeze')
  const old = f.voices.at(-1); f.clock.event('keydown', '1'); assert.equal(old.cancelled, true)
  assert.equal(f.voices.at(-1).key, 'c_practice_pound')
  f.h.unmount()
  checks.push('C practice: movements during voice are ignored; new complete movement succeeds; skip cancels old voice')
}
{
  const f = screenFixture('C'); await startMain(f, 'C')
  for (const [i, cue] of f.gameC.RICE_CUES.entries()) {
    f.clock.advance(7000); f.voices.at(-1).end()
    const opened = f.clock.now
    f.clock.advance(200)
    const pair = cue.player === 1 ? ['q', 'w'] : ['o', 'p']
    const active = cue.action === 'squeeze' ? [cue.player === 1 ? 'e' : 'i']
      : cue.action === 'pound' ? pair : [pair[cue.action === 'left' ? 0 : 1]]
    for (let n = 0; n < (cue.action === 'squeeze' ? 3 : 1); n++) {
      active.forEach(key => f.clock.event('keydown', key)); f.clock.advance(200)
      active.forEach(key => f.clock.event('keyup', key)); f.clock.advance(200)
    }
    f.clock.advance(3000 - (f.clock.now - opened)); assert.equal(f.stage(), 'feedback')
    if (i === 0) { f.pause(); f.clock.advance(30000); assert.equal(f.stage(), 'feedback'); await f.resume() }
    f.clock.advance(1000)
    if (i === 9) {
      f.pause(); f.clock.advance(30000); assert.equal(f.stage(), 'swap'); await f.resume()
      f.clock.advance(4000); f.voices.at(-1).end()
    }
  }
  assert.equal(f.stage(), 'finish'); assert.equal(f.voices.at(-1).key, 'c_finish')
  for (const key of ['q', 'w', 'o', 'p']) f.clock.event('keydown', key)
  f.clock.advance(5000); assert.equal(f.stage(), 'finish', 'Finish hold must not complete during narration')
  f.voices.at(-1).end(); f.clock.advance(1200); assert.equal(f.stage(), 'finish', 'Preheld arms need a fresh neutral-to-raised movement')
  for (const key of ['q', 'w', 'o', 'p']) f.clock.event('keyup', key)
  f.clock.advance(200)
  for (const key of ['q', 'w', 'o', 'p']) f.clock.event('keydown', key)
  f.clock.advance(500); f.pause(); f.clock.advance(30000)
  assert.equal(f.stage(), 'finish'); await f.resume()
  f.clock.advance(1000); assert.equal(f.stage(), 'finish', 'A partial finish hold cannot continue across pause')
  for (const key of ['q', 'w', 'o', 'p']) f.clock.event('keydown', key)
  f.clock.advance(1000); assert.equal(f.stage(), 'finish')
  f.clock.advance(50); assert.equal(f.stage(), 'end')
  f.clock.advance(1600)
  assert.equal(f.results[0].score, 100); assert.equal(f.results[0].finishPoseCompleted, true)
  assert.ok(f.results[0].trials.every(t => t.reactionMs >= 200 && t.reactionMs <= 250), 'Reaction metrics exclude the seven-second instruction')
  f.h.unmount()
  checks.push('C: perfect play remains 100 across feedback/swap pauses; finish hold waits for narration and resets across pause')
}
{
  const f = screenFixture('C', false); await settle(); f.h.flush()
  const pose = f.deps['../game/pose'].poseEngine, grip = f.deps['../game/gameCGrip'].riceGripEngine
  let state = 'open', initializations = 0
  pose.cameraOk = true
  pose.getCBody = () => ({ tracked: false, left: false, right: false, aboveHead: false })
  grip.ready = false
  grip.init = async () => { initializations++; grip.ready = true }
  grip.sample = () => state
  f.clock.advance(200)
  assert.equal(initializations, 1, 'Camera becoming ready after mount must start the finger model')
  f.clock.event('keydown', '1'); f.voices.at(-1).end(); f.clock.advance(200)
  const move = value => { state = value; f.clock.advance(200) }
  for (let i = 0; i < 3; i++) { move('closing'); move('closed'); move('closing'); move('open') }
  assert.equal(f.stage(), 'practiceFeedback', 'Recognized finger joints must survive unavailable body-model wrists')
  f.h.unmount()
  checks.push('C camera path: delayed finger initialization, partial closure and body-wrist occlusion still complete three real grips')
}
{
  const f = screenFixture('C'); await startMain(f, 'C')
  f.voices.at(-1).end(); f.clock.advance(4000)
  assert.equal(f.h.tree.props['data-cue-index'], 1)
  const pose = f.deps['../game/pose'].poseEngine, grip = f.deps['../game/gameCGrip'].riceGripEngine
  let state = 'open'
  pose.cameraOk = true; pose.getCBody = () => ({ tracked: false, left: false, right: false, aboveHead: false })
  grip.ready = false; grip.init = async () => {}; grip.sample = () => grip.ready ? state : 'unknown'
  f.voices.at(-1).end(); f.clock.advance(5000)
  assert.equal(f.stage(), 'play'); assert.equal(f.timer(), 76, 'A pending hand model cannot consume the three-second squeeze window')
  grip.ready = true; f.clock.advance(250)
  for (let n = 0; n < 3; n++) { state = 'closed'; f.clock.advance(200); state = 'open'; f.clock.advance(200) }
  f.clock.advance(1700)
  assert.equal(f.stage(), 'feedback')
  assert.equal(nodes(f.h.tree).find(n => n.type === 'timer').props.value, 73)
  f.h.unmount()
  checks.push('C model preparation: finger readiness gets a full response window and never times out during initialization')
}
function clickScreen(f, label) {
  const button = nodes(f.h.tree).find(n => n.type === 'button' && n.props.children === label)
  assert.ok(button, `Button: ${label}`); assert.ok(!button.props.disabled, `Enabled: ${label}`)
  button.props.onClick(); f.h.flush()
}
function shoppingKey(f, code, type = 'keydown') {
  f.clock.event(type, { code, repeat: false, preventDefault() {} })
}
function shoppingTap(f, code) {
  shoppingKey(f, code); f.clock.advance(250); shoppingKey(f, code, 'keyup'); f.clock.advance(200)
}
async function startShopping(skipPractice = true) {
  const f = screenFixture('D', skipPractice); await settle(); f.h.flush()
  assert.equal(f.stage(), 'ready'); assert.equal(f.voices.at(-1).key, 'd_rules')
  f.clock.advance(9000); assert.equal(f.open(), false, 'Ready waits for the actual voice end')
  f.voices.at(-1).end()
  clickScreen(f, skipPractice ? '장보기 시작' : '잼잼 연습하기')
  return f
}
{
  const f = await startShopping(false)
  assert.equal(f.voices.at(-1).key, 'd_practice'); assert.equal(f.open(), false)
  shoppingTap(f, 'KeyE'); shoppingTap(f, 'KeyI')
  assert.ok(!nodes(f.h.tree).some(n => n.type === 'button' && n.props.children === '장보기 시작'))
  f.voices.at(-1).end(); f.clock.advance(200)
  shoppingTap(f, 'KeyE'); shoppingTap(f, 'KeyI')
  const board = () => nodes(f.h.tree).find(n => n.type === 'shopping-board').props
  assert.equal(board().current.targets[0].collected, 2, 'Accepted practice grips fill the visible basket')
  shoppingTap(f, 'KeyE')
  assert.equal(board().current.targets[0].collected, 2, 'An early grip cannot collect an approaching item')
  f.pause(); const stopped = board().current.items[0].y
  f.clock.advance(30000); assert.equal(board().current.items[0].y, stopped)
  await f.resume(); f.voices.at(-1).end(); f.clock.advance(4000)
  shoppingTap(f, 'KeyE'); shoppingTap(f, 'KeyI')
  assert.equal(board().current.targets[0].collected, 4)
  assert.equal(f.sessions.length, 0, 'Rehearsal must not create a scored session')
  clickScreen(f, '장보기 시작')
  assert.equal(f.stage(), 'starting'); assert.equal(f.voices.at(-1).key, 'd_start')
  f.clock.advance(10000); assert.equal(f.sessions.length, 0, 'Start guidance consumes no shopping time')
  f.voices.at(-1).end(); f.clock.advance(3000)
  assert.equal(f.stage(), 'countdown', 'The shared start image appears before shopping time begins')
  assert.ok(nodes(f.h.tree).some(n => n.type === 'img' && n.props.alt === '시작'))
  assert.equal(f.sessions.length, 0)
  f.clock.advance(200)
  assert.equal(f.stage(), 'play'); assert.equal(f.timer(), 120)
  f.h.unmount()
  checks.push('D practice: pre-voice inputs ignored, two closures per player enable start, countdown begins only after start voice')
}
{
  const f = await startShopping(false)
  const practiceVoice = f.voices.at(-1)
  shoppingKey(f, 'Escape'); shoppingKey(f, 'Digit1')
  assert.equal(f.stage(), 'practice', 'Staff skip cannot escape a paused tutorial')
  shoppingKey(f, 'Escape'); f.voices.at(-1).end()
  shoppingKey(f, 'Digit1')
  assert.equal(f.stage(), 'starting'); assert.equal(practiceVoice.cancelled, true)
  f.voices.at(-1).end(); f.clock.advance(1000)
  shoppingKey(f, 'Escape'); f.clock.advance(30000)
  assert.equal(f.stage(), 'countdown'); assert.equal(f.sessions.length, 0)
  shoppingKey(f, 'Escape'); f.voices.at(-1).end(); f.clock.advance(2200)
  assert.equal(f.stage(), 'play'); assert.equal(f.sessions.length, 1)
  assert.equal(f.timer(), 120)
  f.h.unmount()
  checks.push('D tutorial: staff skip cancels practice narration; paused countdown resumes once with the full 120 seconds')
}
{
  const f = await startShopping(false)
  const pose = f.deps['../game/pose'].poseEngine, grip = f.deps['../game/gameDGrip'].shoppingGripEngine
  let state = 'open'
  pose.cameraOk = true
  pose.getCBody = () => ({ tracked: false })
  grip.sample = now => ({ grips: { 1: state, 2: state }, at: now })
  f.voices.at(-1).end(); f.clock.advance(300)
  state = 'closing'; f.clock.advance(200); state = 'closed'; f.clock.advance(200)
  const board = () => nodes(f.h.tree).find(n => n.type === 'shopping-board').props
  assert.equal(board().current.targets[0].collected, 2, 'Valid finger pairs must not be vetoed by a separate wrist detector')
  state = 'open'; f.clock.advance(4000)
  f.poses.forEach(pose => { pose.present = false })
  state = 'closed'; f.clock.advance(300)
  assert.equal(board().current.targets[0].collected, 2, 'The participant presence safeguard still rejects absent players')
  f.h.unmount()
  checks.push('D camera path: recognized hand pairs survive body-wrist occlusion; absent players still cannot collect')
}
{
  const f = await startShopping()
  const pose = f.deps['../game/pose'].poseEngine, grip = f.deps['../game/gameDGrip'].shoppingGripEngine
  pose.cameraOk = true; grip.ready = false; grip.init = async () => {}
  grip.sample = now => ({ grips: { 1: 'open', 2: 'open' }, at: now })
  f.voices.at(-1).end(); f.clock.advance(5000)
  assert.equal(f.stage(), 'countdown'); assert.equal(f.sessions.length, 0)
  assert.equal(f.h.tree.props['data-paused'], false, 'Model preparation must not trigger a stall pause')
  grip.ready = true; f.clock.advance(3250)
  assert.equal(f.stage(), 'play'); assert.equal(f.sessions.length, 1); assert.equal(f.timer(), 120)
  f.h.unmount()
  checks.push('D model preparation: initialization freezes countdown and preserves the full 120-second session')
}
{
  const f = await startShopping(); f.voices.at(-1).end(); f.clock.advance(3200)
  const run = f.sessions[0]; f.clock.advance(200)
  shoppingKey(f, 'KeyE'); shoppingKey(f, 'KeyI'); f.clock.advance(250)
  shoppingKey(f, 'KeyE', 'keyup'); shoppingKey(f, 'KeyI', 'keyup'); f.clock.advance(200)
  assert.equal(run.events.filter(e => e.outcome === 'correct').length, 2)
  assert.equal(f.voices.filter(v => v.key === 'd_correct').length, 1, 'Simultaneous players share one narration')
  const feedback = f.voices.at(-1), elapsed = run.elapsedMs
  f.clock.advance(500); assert.ok(run.elapsedMs > elapsed, 'Feedback leaves the game clock running')
  shoppingTap(f, 'KeyE'); assert.equal(f.voices.at(-1), feedback, 'Busy feedback is not interrupted')
  feedback.end(); shoppingTap(f, 'KeyE'); assert.equal(f.voices.at(-1), feedback, 'Cooldown suppresses repeated speech')
  shoppingKey(f, 'Escape'); const pausedAt = run.elapsedMs
  assert.equal(feedback.cancelled, true); f.clock.advance(8000); assert.equal(run.elapsedMs, pausedAt)
  shoppingKey(f, 'Escape'); assert.equal(f.voices.at(-1).key, 'd_resume')
  const resumeVoice = f.voices.at(-1)
  f.clock.advance(6000); assert.equal(run.elapsedMs, pausedAt, 'Resume instruction precedes game clock restart')
  shoppingTap(f, 'KeyE'); assert.equal(run.elapsedMs, pausedAt)
  resumeVoice.end(); f.clock.advance(1000); assert.equal(run.elapsedMs, pausedAt + 1000)
  f.clock.advance(120000 - run.elapsedMs)
  assert.equal(f.stage(), 'end'); assert.equal(f.voices.at(-1).key, 'd_timeout')
  f.clock.advance(6000); assert.equal(f.results.length, 0, 'Longer ending voice cannot be cut by the old 2.1s timeout')
  f.voices.at(-1).end(); assert.equal(f.results.length, 1); assert.equal(f.results[0].elapsedMs, 120000)
  f.h.unmount(); f.clock.advance(20000); assert.equal(f.results.length, 1)
  checks.push('D play: feedback is nonblocking and rate-limited; pause cancels it, resume freezes time, timeout waits for voice')
}
{
  const f = await startShopping(); const startVoice = f.voices.at(-1)
  shoppingKey(f, 'Escape'); assert.equal(startVoice.cancelled, true)
  shoppingKey(f, 'Escape'); assert.equal(f.voices.at(-1).key, 'd_resume')
  f.voices.at(-1).end(); f.clock.advance(3200)
  const run = f.sessions[0]
  // Set up one remaining basket item, then complete it through the production input path.
  run.targets.forEach(t => { t.collected = t.required })
  run.targets[0].collected--
  run.items = [{ id: 999, player: 1, product: run.targets[0].product, y: 940, enteredAt: 0, missed: false }]
  f.clock.advance(200); shoppingTap(f, 'KeyE')
  assert.equal(f.stage(), 'end'); assert.equal(f.voices.at(-1).key, 'd_success')
  const successVoice = f.voices.at(-1)
  f.clock.advance(5000); assert.equal(f.results.length, 0)
  f.h.unmount(); successVoice.end(); f.clock.advance(10000)
  assert.equal(f.results.length, 0, 'Unmount must cancel a pending success transition')
  const mapping = load('src/game/gameDVoice.ts').shoppingFeedbackVoice
  assert.equal(mapping({ outcome: 'empty' }), 'd_empty')
  assert.equal(mapping({ outcome: 'wrong', reason: 'not-listed' }), 'd_wrong')
  assert.equal(mapping({ outcome: 'wrong', reason: 'already-complete' }), 'd_complete')
  checks.push('D lifecycle: interrupted start can resume, success uses its own clip, exit cancels pending result, error clips map correctly')
}
{
  const clock = new Clock(), h = hooks(clock), voices = []
  const dummy = () => null
  const { TutorialScreen } = load('src/screens/TutorialScreen.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    '../assets': { FX: {}, IMG: {}, TUT_CHAR: {}, frameSize: () => ({}) },
    '../components/GameTools': { GameTools: dummy },
    '../components/Sprite': { Sprite: dummy }, '../components/GameBAvatar': { GameBAvatar: dummy },
    '../components/GameCRabbit': { RabbitPortrait: dummy }, '../components/GameDShopper': { GameDShopper: dummy },
    '../game/gameCAssets': { GAME_C_IMAGES: {} }, '../game/camera': { cameraStream: () => null },
    '../game/bgm': { playBgm() {} },
    '../game/pose': { poseEngine: { ready: true, cameraOk: false, getPose: () => ({ present: true }),
      getCBody: () => ({ tracked: true, left: false, right: false, leftX: .25, rightX: .735, leftY: .69, rightY: .69 }) } },
    '../game/audio': { playSfx() {}, runNarration(key, end) {
      const voice = { key, cancelled: false, end() { if (!voice.cancelled) { end(); h.flush() } } }
      voices.push(voice); return () => { voice.cancelled = true }
    } },
  }, clock.globals())
  h.mount(() => TutorialScreen({ game: 'ricecake', onDone() {} }))
  voices.at(-1).end(); clock.advance(1800)
  assert.equal(voices.at(-1).key, 'handPosition')
  clock.advance(7000); assert.equal(voices.at(-1).key, 'handPosition', 'Holding hands in place cannot skip the spoken instruction')
  voices.at(-1).end(); clock.advance(1100); assert.equal(voices.at(-1).key, 'stretch')
  h.unmount(); assert.equal(voices.at(-1).cancelled, true)
  checks.push('C setup: existing hand-position clip plays once, body hold starts after narration, exit cancels audio')
}
{
  const wall = new Clock()
  const { GameClock } = load('src/game/gameClock.ts', {}, wall.globals())
  const active = new GameClock(), calls = []
  active.setTimeout(() => calls.push('timeout'), 1000)
  const repeat = active.setInterval(() => calls.push('tick'), 250)
  wall.advance(400); active.pause(); const frozen = active.now()
  active.setTimeout(() => calls.push('added while paused'), 200)
  wall.advance(120000)
  assert.equal(active.now(), frozen); assert.deepEqual(calls, ['tick'])
  active.resume(); wall.advance(199); assert.deepEqual(calls, ['tick', 'tick'])
  wall.advance(1); assert.equal(calls.at(-1), 'added while paused')
  wall.advance(400); assert.equal(calls.filter(x => x === 'timeout').length, 1)
  active.clearInterval(repeat); active.dispose(); wall.advance(5000)
  assert.equal(calls.filter(x => x === 'tick').length, 4)
  checks.push('Pause clock: deadlines and intervals freeze, resume with remaining time, and do not catch up paused time')
}
{
  const f = audioFixture(); await f.api.initAudio()
  let ended = 0
  f.api.runNarration('c_swap', () => ended++, 4000); await settle()
  f.clock.advance(1000); f.api.pauseGameAudio(); await settle()
  f.sources.at(-1).end() // A queued audio event at the exact blur boundary.
  f.clock.advance(30000); assert.equal(ended, 0)
  await f.api.resumeGameAudio(); f.clock.advance(2999); assert.equal(ended, 0)
  f.clock.advance(1); assert.equal(ended, 1)
  const fallback = audioFixture({ missing: true }); await fallback.api.initAudio()
  let fallbackEnded = 0
  fallback.api.speakCommand(['청기'], '청기', false, () => fallbackEnded++)
  fallback.clock.advance(500); fallback.api.pauseGameAudio(); fallback.clock.advance(30000)
  assert.equal(fallbackEnded, 0)
  await fallback.api.resumeGameAudio(); fallback.clock.advance(699); assert.equal(fallbackEnded, 0)
  fallback.clock.advance(1); assert.equal(fallbackEnded, 1)
  const slow = audioFixture({ slow: true }); let loadedEnd = 0
  slow.api.runNarration('b_start', () => loadedEnd++)
  slow.api.pauseGameAudio(); slow.release(); await settle(); slow.clock.advance(30000)
  assert.equal(slow.sources.length, 0, 'Loading while paused cannot start voice or fallback')
  await slow.api.resumeGameAudio(); slow.clock.advance(0)
  assert.equal(slow.sources.length, 1); slow.sources[0].end(); assert.equal(loadedEnd, 1)
  checks.push('Paused audio: queued end, minimum role-swap duration, word fallback and late loading cannot advance games')
}
for (const game of ['A', 'B', 'C']) {
  const f = screenFixture(game); await settle(); f.h.flush()
  f.animation(game === 'C' ? 'gameCFromBlack' : 'gameFadeIn')
  if (game === 'C') { f.clock.advance(3000); f.animation('gameCBackgroundFocus'); f.animation('sceneUiDissolve') }
  f.clock.advance(600); f.pause()
  f.clock.advance(30000); assert.equal(f.stage(), 'countdown')
  // Focus alone never resumes; neither staff shortcut advances the paused screen.
  f.clock.event('focus'); f.clock.event('keydown', '1'); f.clock.event('keydown', '2')
  assert.equal(f.h.tree.props['data-game-paused'], true)
  await f.resume(); f.clock.advance(2562)
  assert.equal(f.stage(), game === 'C' ? 'play' : 'main')
  const cueVoice = f.voices.at(-1)
  f.clock.event('blur'); assert.equal(f.h.tree.props['data-game-paused'], true)
  cueVoice.end(); f.clock.advance(30000)
  if (game === 'A') assert.equal(f.runners[0].phase, 'speak')
  else assert.equal(f.open(), false)
  await f.resume(); f.clock.advance(500)
  const before = f.timer()
  f.doc.hidden = true; f.clock.event('visibilitychange')
  f.clock.advance(30000); assert.equal(f.timer(), before)
  await f.resume(); assert.equal(f.h.tree.props['data-game-paused'], true, 'Hidden tabs cannot resume')
  f.doc.hidden = false; f.clock.event('visibilitychange')
  assert.equal(f.h.tree.props['data-game-paused'], true)
  await f.resume(); f.clock.advance(game === 'B' ? 5500 : game === 'C' ? 2500 : 1900)
  if (game === 'A') assert.equal(f.trials.length, 1)
  else if (game === 'B') assert.equal(f.h.tree.props['data-event-index'], 1)
  else assert.equal(f.stage(), 'feedback')
  f.h.unmount(); f.clock.advance(60000); assert.equal(f.results.length, 0)
}
checks.push('A/B/C screens: countdown, narration, action time, blur, hidden tabs, shortcuts and exit honor pause')
{
  const f = screenFixture('A'); await settle(); f.h.flush(); f.animation('gameFadeIn'); f.clock.advance(3162)
  const session = f.starts[0]
  assert.ok(session.startedAt)
  const runner = f.runners[0]
  for (let i = 0; i < 20; i++) {
    const onset = runner.onsetAt
    f.voices.at(-1).end(); f.clock.advance(2400)
    assert.equal(runner.logs.length, i + 1)
    assert.equal(runner.logs[i].구령시작시각, onset)
    if (i === 0) {
      f.pause(); f.clock.advance(60000); assert.equal(runner.phase, 'feedback'); assert.equal(runner.logs.length, 1)
      await f.resume()
    }
    f.clock.advance(1200)
    if (i === 9) {
      assert.equal(runner.phase, 'roleswap'); f.pause(); f.clock.advance(60000)
      assert.equal(runner.phase, 'roleswap'); await f.resume(); f.clock.advance(5200)
    }
  }
  f.clock.advance(2600)
  assert.equal(f.results.length, 1); assert.equal(f.results[0].logs.length, 20)
  assert.equal(f.results[0].session.startedAt, session.startedAt)
  assert.equal(f.results[0].session.inputMode, '키보드')
  f.h.unmount()
  const partial = screenFixture('A'); await settle(); partial.h.flush(); partial.animation('gameFadeIn'); partial.clock.advance(3162)
  partial.clock.event('keydown', '2'); partial.clock.event('keydown', '2'); partial.clock.advance(2600)
  assert.equal(partial.results[0].logs.length, 0)
  assert.equal(partial.results[0].session.startedAt, partial.starts[0].startedAt)
  partial.h.unmount()
  checks.push('A session: 20 unique trials across feedback/role-swap pauses; start metadata survives completion and zero-cue abort')
}
console.log(JSON.stringify({ status: 'passed', groups: checks.length, checks }, null, 2))
