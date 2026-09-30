// Read-only audit reproductions. Compiles existing sources into isolated VMs;
// no browser, camera, Supabase, real credentials, or production data is used.
// Assertions below document the CURRENT defective outcomes. A passing run means
// the findings are reproducible, not that the game is correct. Invert these
// expectations into regression tests when the corresponding defects are fixed.
// Historical audit for commit 5cc67a1 only. Current fixed sources are verified by
// npm test (scripts/test-game-regressions.mjs); these old defect assertions now fail.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const results = []
const controls = []
function load(file, dependencies = {}, globals = {}, env = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replaceAll('import.meta.env', JSON.stringify(env))
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const exports = {}
  const noop = () => 0
  const context = vm.createContext({ exports, console,
    require: id => { if (id in dependencies) return dependencies[id]; throw new Error(`Unexpected import: ${id}`) },
    window: { setInterval: noop, clearInterval: noop, addEventListener: noop },
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    performance: { now: () => 1000 }, ...globals,
  })
  vm.runInContext(js, context, { filename: file })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const rest = { present: true, leftRaised: false, rightRaised: false, leftWristY: .7, rightWristY: .7 }
let now = 100
let poses = [{ ...rest }, { ...rest }]
let speechEnd
const audio = { speakCommand: (...args) => { speechEnd = args.at(-1) }, stopSpeech() {}, neutralTick() {}, playSfx() {}, transitionChime() {} }
const { GameRunner } = load('src/game/engine.ts', { './pose': { poseEngine: { getPose: pid => poses[pid - 1] } }, './audio': audio }, { performance: { now: () => now } })
const { COMMANDS } = load('src/game/commands.ts')
function runCue(expect, duringWindow = () => {}) {
  now = 100
  const r = new GameRunner({ commands: [{ ...COMMANDS[0], expect }], scored: true, onSnapshot() {}, onFinish() {} })
  r.start(); now = 1000; speechEnd(900)
  duringWindow(r)
  now = 3000; r.tick(); r.stop()
  return plain(r.logs[0])
}
poses = [{ ...rest, present: false }, { ...rest, present: false }]
const absent = runCue({ p1: 'none', p2: 'none' })
assert.equal(absent.획득점수, 5)
results.push({ id: 'A-absence', observed: 'Neither player tracked: fake command awards 5 points', log: absent.판정 })
let absentScore = 0
for (const cmd of COMMANDS) absentScore += runCue(cmd.expect).획득점수
assert.equal(absentScore, 60)
results.push({ id: 'A-absence-full-run', observed: `20 commands without either participant: ${absentScore}/100` })

poses = [{ ...rest }, { ...rest }]
const shortHold = runCue({ p1: 'both', p2: 'none' }, r => {
  now = 2999; poses[0] = { ...rest, leftRaised: true, rightRaised: true }; r.tick()
})
assert.equal(shortHold.판정.P1.정답, true)
results.push({ id: 'A-hold', observed: '1ms raise immediately before deadline counts as correct, despite HOLD_MS=250', log: shortHold.판정.P1 })

let perfectScore = 0
for (const cmd of COMMANDS) {
  poses = [{ ...rest }, { ...rest }]
  const output = runCue(cmd.expect, r => {
    const asPose = action => ({ ...rest, leftRaised: action === 'left' || action === 'both', rightRaised: action === 'right' || action === 'both' })
    now = 1200; poses = [asPose(cmd.expect.p1), asPose(cmd.expect.p2)]; r.tick()
    now = 1500; r.tick()
  })
  perfectScore += output.획득점수
}
assert.equal(perfectScore, 100)
controls.push('A: all 20 prescribed commands with stable correct input award 100 points')
poses = [{ ...rest }, { ...rest }]
const early = runCue({p1:'both',p2:'none'}, r => {
  r.tracks[1].left.premature = true
})
assert.equal(early.판정.P1.오류유형, '조급반응')
controls.push('A: premature-reaction flag is scored as incorrect')

const { FanCounter, playerTaskResults } = load('src/game/gameB.ts')
const fanPair = [new FanCounter(), new FanCounter()]
function fanFeed(index, pose, t) { fanPair[index].update(pose, t); fanPair[index].update(pose, t + 160) }
for (const [pose, t] of [[rest, 0], [{ ...rest, leftRaised: true, rightRaised: true }, 300], [rest, 600], [{ ...rest, leftRaised: true, rightRaised: true }, 900], [rest, 1200]]) fanFeed(0, pose, t)
fanFeed(1, rest, 0)
fanFeed(1, { ...rest, leftRaised: true, rightRaised: true }, 300)
const incorrectRest = plain(playerTaskResults('left', fanPair, 1500, 2))
assert.deepEqual(incorrectRest, [true, true])
results.push({ id: 'B-inactive-player', observed: 'Right player raises and keeps both arms up during left-only cue: both marked correct', counts: fanPair.map(c => c.count) })
const stillPair = [new FanCounter(), new FanCounter()]
stillPair.forEach(c=>{c.update(rest,0);c.update(rest,2500)})
assert.deepEqual(plain(playerTaskResults('big',stillPair,2500,2)),[true,true])
stillPair[1].update({...rest,present:false},2600)
assert.deepEqual(plain(playerTaskResults('big',stillPair,2600,2)),[true,false])
controls.push('B: tracked 2-second stillness succeeds, missing player fails the stillness cue')

let sampled = { ...rest, leftRaised: true, rightRaised: true, noseX: .5, noseY: .2, shoulderY: .4 }
let batches = []
const { motionSampler } = load('src/game/motion.ts', { './pose': { poseEngine: { getPose: () => sampled } }, './telemetry': { logMotionWindows: rows => batches.push(...plain(rows)) } })
motionSampler.start()
for (let sec = 0; sec < 3; sec++) { for (let tick = 0; tick < 20; tick++) motionSampler.sample(); motionSampler.closeWindow() }
motionSampler.stop()
const p1Windows = batches.filter(x => x.actor_code === 'P1')
assert.deepEqual(p1Windows.map(x => x.rep_count), [2, 2, 2])
results.push({ id: 'motion-window-boundary', observed: 'One continuous two-arm hold counted as 6 raises across 3 seconds', counts: p1Windows.map(x => x.rep_count) })

const queueKey = 'bv.telemetry.queue.v1'
const queueStorage = new Map([[queueKey, JSON.stringify([{ kind: 'insert', table: 'session', rows: [{ session_id: 'old' }] }])]])
const sent = []
let release
const response = { ok: true, status: 201, text: async () => '' }
const teleDeps = { './supabaseEnv': { SUPABASE_URL: 'https://audit.invalid', SUPABASE_KEY: 'fake-only' }, './auth': { currentPlayerCodes: () => ['01','02'], currentSiteCode: () => 'audit' } }
const storage = data => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) })
const telemetry = load('src/game/telemetry.ts', teleDeps, {
  localStorage: storage(queueStorage), crypto: { randomUUID: () => 'new-session' },
  fetch: (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Promise(resolve => { release = resolve }) },
})
const pendingFlush = telemetry.flushQueue()
telemetry.startSession({ gameKey: 'orak_flag', appVersion: 'audit', inputMode: '키보드' })
assert.equal(JSON.parse(queueStorage.get(queueKey)).length, 2)
release(response); await pendingFlush
assert.equal(JSON.parse(queueStorage.get(queueKey)).length, 0)
assert.equal(sent.length, 1)
results.push({ id: 'telemetry-queue-race', observed: 'A new session appended during an awaited retry is deleted unsent when flush saves its stale queue snapshot', sent: sent.length, remaining: 0 })

const closeCalls = []
let finishSessionInsert
const closeWarnings = []
const race = load('src/game/telemetry.ts', teleDeps, {
  console: { ...console, warn: (...args) => closeWarnings.push(args) },
  localStorage: storage(new Map()), crypto: { randomUUID: () => 'slow-session' },
  fetch: (url, init) => {
    closeCalls.push(url.split('/').at(-1))
    return url.endsWith('/session') ? new Promise(resolve => { finishSessionInsert = resolve }) : Promise.resolve({ ...response, text: async () => 'false' })
  },
})
race.startSession({ gameKey: 'orak_flag', appVersion: 'audit', inputMode: '키보드' })
race.endSession({ completed: false, teamScore: 0, maxScore: 100, commandsPlayed: 0 })
await new Promise(resolve => setImmediate(resolve))
assert.deepEqual(closeCalls, ['session', 'close_session'])
assert.equal(closeWarnings.length, 1)
finishSessionInsert(response)
results.push({ id: 'telemetry-close-order', observed: 'close_session sent before pending session INSERT completes; false response discarded' })

// A delayed hand-model startup can finish after the screen disabled gestures.
let resolveCamera
const cameraGate = new Promise(resolve => { resolveCamera = resolve })
const { handEngine } = load('src/game/hand.ts', {
  '@mediapipe/tasks-vision': {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    GestureRecognizer: { createFromOptions: async () => ({ recognizeForVideo: () => ({ gestures: [] }) }) },
  },
  './camera': { openCamera: () => cameraGate, cameraReady: () => false, cameraVideo: () => null },
  './pose': { poseEngine: { pointer: () => ({ visible: false, x: .5, y: .5 }) } },
}, { document: { createElement: () => ({ getContext: () => null }) } }, { BASE_URL: '/' })
const startingHand = handEngine.start(1000, () => {})
handEngine.stop()
resolveCamera({ videoWidth: 1280, videoHeight: 720 })
await startingHand
assert.equal(handEngine.status().running, true)
results.push({ id: 'hand-start-after-stop', observed: 'Pending start() re-enables gesture engine after stop() has disabled it' })

// Global backup keys need a blur reset, or a missed keyup becomes a held pose.
const listeners = new Map()
const { poseEngine } = load('src/game/pose.ts', {
  '@mediapipe/tasks-vision': {}, './camera': {},
}, { window: { addEventListener: (name, fn) => listeners.set(name, fn) } })
listeners.get('keydown')({ key: 'q' })
listeners.get('blur')?.()
assert.equal(poseEngine.getPose(1).leftRaised, true)
results.push({ id: 'pose-stuck-backup-key', observed: 'Q remains raised after window blur: no blur reset registered for A/B backup keys' })

const commonAssets = load('src/assets.ts', {}, {}, {BASE_URL:'/'})
const bAssets = load('src/game/gameBAssets.ts', {'../assets':commonAssets})
const cAssets = load('src/game/gameCAssets.ts', {'../assets':commonAssets})
const files = new Set()
function collect(value) {
  if (typeof value === 'string' && value.startsWith('/assets/')) files.add(value)
  else if (value && typeof value === 'object') Object.values(value).forEach(collect)
}
[commonAssets,bAssets,cAssets].forEach(collect)
for(const rabbit of ['pink','brown']) for(const pose of ['up','down','idle','squeeze-1','squeeze-2']) files.add(cAssets.rabbitSrc(rabbit,pose))
const missing = [...files].filter(file=>!existsSync(new URL(`../public${file}`,import.meta.url)))
assert.deepEqual(missing,[])
controls.push(`Referenced image manifests: ${files.size} local asset files all exist`)

console.log(JSON.stringify({ base: '5cc67a1', controls, reproduced: results }, null, 2))
