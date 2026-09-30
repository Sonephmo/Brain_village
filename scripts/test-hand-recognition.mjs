import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(file, deps = {}, globals = {}) {
  const source = readFileSync(new URL('../src/game/' + file + '.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', JSON.stringify({ BASE_URL: '/' }))
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, console, ...globals, require: id => { assert.ok(id in deps, id); return deps[id] } })
  return exports
}
const real = JSON.parse(readFileSync(new URL('../docs/hand-recognition/model-report.json', import.meta.url)))
assert.equal(real.passed, true)
const open = real.tests.find(test => test.expected === 'open').hands[0]
const closed = real.tests.find(test => test.expected === 'closed').hands[0]
const hand = load('handGrip'), frameApi = load('playerFrame'), rice = load('gameC')
const shopping = load('gameD', { './gameDCatalog': load('gameDCatalog') })
let groups = 0
const pass = name => { groups++; console.log('PASS ' + name) }
for (const [source, expected] of [[open, 'open'], [closed, 'closed']]) {
  const observation = { landmarks: source.landmarks, worldLandmarks: source.worldLandmarks, gesture: { categoryName: 'None', score: .99 } }
  assert.equal(hand.inspectHand(observation).grip, expected)
  for (const angle of [0, .7, 1.5, 3]) {
    const points = source.worldLandmarks.map(p => ({ x: 2 * (p.x * Math.cos(angle) - p.y * Math.sin(angle)), y: 2 * (p.x * Math.sin(angle) + p.y * Math.cos(angle)), z: p.z * 2 }))
    assert.equal(hand.inspectHand({ ...observation, worldLandmarks: points }).grip, expected)
  }
}
assert.equal(hand.inspectHand({ landmarks: [] }).grip, 'unknown')
assert.equal(hand.inspectHand({ landmarks: Array.from({ length: 21 }, () => ({ x: .5, y: .5 })) }).grip, 'unknown')
assert.equal(hand.pairedGrip(['open', 'closed']), 'closing')
assert.equal(hand.pairedGrip(['open']), 'unknown')
pass('Real model landmarks: None labels, rotated/scaled hands, degenerate hands and partial pairs')

let now = 1000, video = { currentTime: 1, videoWidth: 1280, videoHeight: 720, readyState: 4 }, creates = 0, closes = 0
let results = {}, menuResult, failing = new Set(), options = [], draws = [], inferred = []
const camera = { cameraVideo: () => video, cameraReady: () => true, openCamera: async () => video, cameraStream: () => null }
const canvas = () => {
  const element = { width: 0, height: 0, player: null }
  element.getContext = () => ({ fillRect() {}, drawImage(source, ...args) {
    if (args.length === 8) element.player = args[0] === source.videoWidth / 2 ? 1 : 2
    draws.push({ player: element.player, args })
  } })
  return element
}
const globals = { performance: { now: () => now }, document: { createElement: canvas } }
const empty = { landmarks: [], gestures: [] }
const model = { FilesetResolver: { forVisionTasks: async () => ({}) }, GestureRecognizer: { createFromOptions: async (fileset, config) => {
  creates++; options.push(config)
  return { close() { closes++ }, recognizeForVideo(input, at) {
    inferred.push({ player: input.player, at })
    if (failing.has(input.player)) throw new Error('inference failed for ' + input.player)
    return input.player ? results[input.player] ?? empty : menuResult ?? empty
  } }
} } }
function frame(states, positions = [.3, .7]) {
  const samples = states.map(state => state === 'closed' ? closed : open)
  return { landmarks: samples.map((sample, i) => sample.landmarks.map(p => ({ ...p, x: positions[i] + (p.x - sample.landmarks[0].x) * .1 }))),
    worldLandmarks: samples.map(sample => sample.worldLandmarks), gestures: samples.map(() => [{ categoryName: 'None', score: .99 }]) }
}
const shared = load('playerGrip', { '@mediapipe/tasks-vision': model, './camera': camera, './handGrip': hand, './playerFrame': frameApi }, globals)
const c = load('gameCGrip', { './playerGrip': shared }).riceGripEngine
const d = load('gameDGrip', { './playerGrip': shared }).shoppingGripEngine
await Promise.all([c.init(), d.init()]); await c.init()
assert.equal(creates, 2, 'C/D reuse exactly one two-hand model per participant')
assert.ok(options.every(option => option.numHands === 2))
assert.equal(inferred.length, 2, 'Both models are warmed before ready')

// Drive the flag game's actual frame loop, then compare its source regions with both hand engines.
let poseRaf = () => {}
const poseApi = load('pose', { './camera': camera, './playerFrame': frameApi, '@mediapipe/tasks-vision': {
  ...model, PoseLandmarker: { createFromOptions: async () => ({ close() {}, detectForVideo() {
    const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .6, z: 0, visibility: 1 }))
    lm[0].y = .2; lm[11].y = lm[12].y = .4; lm[23].y = lm[24].y = .8
    return { landmarks: [lm] }
  } }) },
} }, { ...globals, window: { addEventListener() {}, setInterval() { return 0 } }, document: { ...globals.document, addEventListener() {} },
  requestAnimationFrame: callback => { poseRaf = callback; return 1 } })
await poseApi.poseEngine.init(); poseApi.poseEngine.setMode('game')
now += 100; draws = []; poseRaf()
const flagDraws = draws.slice(-2)
results = { 1: frame(['open', 'open']), 2: frame(['closed', 'closed']) }
now += 100; video.currentTime += .1; draws = []
const pair = d.sample(now)
assert.equal(pair.grips[1], 'open'); assert.equal(pair.grips[2], 'closed')
for (const pid of [1, 2]) {
  const source = draws.find(draw => draw.player === pid)
  assert.deepEqual(source.args.slice(0, 4), flagDraws[pid - 1].args.slice(0, 4), 'Hands and flag poses use the exact same raw region')
  assert.deepEqual(source.args, [pid === 1 ? 640 : 0, 0, 640, 720, 0, 0, 640, 720])
  assert.equal(poseApi.poseEngine.getPose(pid).present, true)
}
assert.equal(c.sample(2, now + 10), 'closed')
assert.equal(c.sample(1, now + 20), 'open', 'Changing the rice role cannot reuse another participant\'s grip')
assert.equal(creates, 2)
pass('Flag/C/D share exact mirrored crops; two independent hand models survive role swaps without new models')

const tracker = new rice.RiceActionTracker('squeeze', 0)
function feedRice(states, frames = 3) {
  results[1] = frame(states)
  for (let i = 0; i < frames; i++) { now += 100; video.currentTime += .1
    tracker.update({ tracked: true, left: false, right: false, grip: c.sample(1, now) }, now)
  }
}
feedRice(['open', 'open'])
for (let n = 0; n < 3; n++) {
  feedRice(['closed', 'open'], 1)
  assert.equal(c.status().grip, 'closing', 'One hand closing early is not tracking loss')
  feedRice(['closed', 'closed']); feedRice(['open', 'closed'], 1); feedRice(['open', 'open'])
  assert.equal(tracker.count, n + 1)
}
assert.equal(tracker.complete, true)
now += 500; assert.equal(c.sample(1, now), 'unknown', 'Frozen video must not keep a valid grip')
pass('Rice engine -> tracker: three real-joint open-close-open cycles survive asynchronous hands and reject frozen video')

const counters = { 1: new shopping.ShoppingGripTracker(), 2: new shopping.ShoppingGripTracker() }, counts = { 1: 0, 2: 0 }
d.reset()
function feedShopping(first, second, frames = 3) {
  results = { 1: frame(first, [.02, .98]), 2: frame(second, [.98, .02]) }
  for (let i = 0; i < frames; i++) { now += 100; video.currentTime += .1
    const sampled = d.sample(now)
    for (const pid of [1, 2]) if (counters[pid].update(sampled.grips[pid], sampled.at)) counts[pid]++
  }
}
feedShopping(['open', 'open'], ['open', 'open'])
feedShopping(['closed', 'open'], ['open', 'closed'], 1)
feedShopping(['closed', 'closed'], ['open', 'open'])
assert.deepEqual(counts, { 1: 1, 2: 0 }, 'One participant cannot collect for the other')
feedShopping(['closed', 'closed'], ['closed', 'closed'])
assert.deepEqual(counts, { 1: 1, 2: 1 })
feedShopping(['closed', 'closed'], ['closed', 'closed'], 10)
assert.deepEqual(counts, { 1: 1, 2: 1 }, 'Held fists must not repeat')
feedShopping(['open', 'open'], ['open', 'open']); feedShopping(['closed', 'closed'], ['closed', 'closed'])
assert.deepEqual(counts, { 1: 2, 2: 2 })
const blocked = d.sample(now); blocked.grips[1] = 'unknown'
assert.equal(d.sample(now + 10).grips[1], 'closed', 'Body presence must not corrupt cached hand results')
results[1] = frame(['open']); results[2] = frame(['open', 'open'])
now += 100; video.currentTime += .1
assert.equal(d.sample(now).grips[1], 'unknown'); assert.equal(d.sample(now).grips[2], 'open')
now += 500; assert.equal(d.sample(now).grips[2], 'unknown')
pass('Shopping: independent pairs, crop edges, fresh closures, missing hands and body-gate cache isolation')

failing.add(2)
for (let i = 0; i < 3; i++) { now += 100; video.currentTime += .1; d.sample(now) }
assert.match(d.error, /inference failed for 2/)
assert.equal(d.status().players[1].grip, 'unknown', 'Missing pair never becomes an inferred gesture')
failing.clear()
pass('Per-player inference failures remain visible and cannot complete a movement')

let gpuMakes = 0, fallbackClosed = 0, cpuMakes = 0
const retry = load('playerGrip', { './camera': camera, './handGrip': hand, './playerFrame': frameApi, '@mediapipe/tasks-vision': {
  FilesetResolver: model.FilesetResolver, GestureRecognizer: { createFromOptions: async (fileset, config) => {
    if (config.baseOptions.delegate === 'GPU' && ++gpuMakes === 2) throw new Error('GPU unavailable')
    if (config.baseOptions.delegate === 'CPU') cpuMakes++
    return { close() { fallbackClosed++ }, recognizeForVideo: () => empty }
  } },
} }, globals).playerGripEngine
await retry.init()
assert.equal(retry.ready, true); assert.equal(cpuMakes, 2); assert.equal(fallbackClosed, 1)
pass('GPU fallback closes a partial pair and prepares two CPU models without leaking the first model')

let raf = () => {}, clicks = 0
const menu = load('hand', { '@mediapipe/tasks-vision': model, './handGrip': hand,
  './camera': camera, './pose': { poseEngine: { pointer: () => ({ visible: true, x: .5, y: .5 }) } },
}, { ...globals, requestAnimationFrame: callback => { raf = callback; return 1 }, cancelAnimationFrame() {} }).handEngine
menuResult = frame(['open'])
assert.equal(await menu.start(1000, () => clicks++), true)
const dwell = (state, frames) => { menuResult = frame([state]); results[2] = menuResult; for (let i = 0; i < frames; i++) { now += 100; raf() } }
dwell('open', 4); dwell('closed', 16); assert.equal(clicks, 1)
dwell('closed', 20); assert.equal(clicks, 1)
dwell('open', 4); dwell('closed', 16); assert.equal(clicks, 2)
menu.stop(); assert.equal(menu.status().running, false)
pass('Menu grip preserves one-second dwell and reopen-to-click protection')
console.log('Hand recognition: ' + groups + ' regression groups passed.')
