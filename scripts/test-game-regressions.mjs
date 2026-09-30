// Behavioral regression checks. Runs production source with controlled input/time/network;
// no real webcam, credentials, browser, or Supabase writes are used.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const passed = []
function load(file, dependencies = {}, globals = {}, env = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replaceAll('import.meta.env', JSON.stringify(env))
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const exports = {}
  const noop = () => 0
  vm.runInNewContext(js, { exports, console,
    require: id => { if (id in dependencies) return dependencies[id]; throw new Error(`Unexpected import: ${id}`) },
    window: { setInterval: noop, clearInterval: noop, addEventListener: noop },
    document: { addEventListener: noop },
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    performance: { now: () => 1000 }, ...globals,
  }, { filename: file })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const rest = { present: true, handsTracked: true, leftRaised: false, rightRaised: false, leftWristY: .7, rightWristY: .7 }
const up = { ...rest, leftRaised: true, rightRaised: true }
let now = 100
let poses = [{ ...rest }, { ...rest }]
let speechEnd
const audio = { speakCommand: (...args) => { speechEnd = args.at(-1) }, stopSpeech() {}, neutralTick() {}, playSfx() {}, transitionChime() {} }
const { GameRunner } = load('src/game/engine.ts', { './pose': { poseEngine: { getPose: pid => poses[pid - 1] } }, './audio': audio }, { performance: { now: () => now } })
const { COMMANDS } = load('src/game/commands.ts')
function runCue(expect, duringWindow = () => {}, duringSpeech = () => {}) {
  now = 100
  const r = new GameRunner({ commands: [{ ...COMMANDS[0], expect }], scored: true, onSnapshot() {}, onFinish() {} })
  r.start(); duringSpeech(r); now = 1000; speechEnd(900)
  duringWindow(r)
  now = Math.max(now, 3000); r.tick(); r.stop()
  return plain(r.logs[0])
}
poses = [{ ...rest, present: false }, { ...rest, present: false }]
let absentScore = 0
for (const cmd of COMMANDS) {
  const log = runCue(cmd.expect)
  absentScore += log.획득점수
  assert.equal(log.판정.P1.정답, false)
  assert.equal(log.판정.P2.오류유형, '누락')
}
assert.equal(absentScore, 20, 'Only the existing one-point encouragement per cue remains')
for (const partial of [true, false]) {
  poses = [{ ...rest }, { ...rest }]
  const log = runCue({p1:'none',p2:'none'}, r => {
    now = 1500; poses[0] = { ...rest, present: partial, handsTracked: false }; r.tick()
    now = 1800; poses[0] = { ...rest }; r.tick()
  })
  assert.equal(log.판정.P1.정답, false, 'Tracking loss cannot turn into successful inhibition on recovery')
  assert.equal(log.판정.P2.정답, true)
}
poses = [up, rest]
assert.equal(runCue({p1:'none',p2:'none'}).판정.P1.정답, false, 'Already raised hands are not inhibition')
poses = [{ ...rest, present: false }, rest]
const practice = new GameRunner({ commands: [COMMANDS[0]], scored: false, waitForSuccess: true, onSnapshot() {}, onFinish() {} })
assert.equal(practice.poseMatches(1, 'none'), false)
passed.push('A: absent/occluded/lost tracking never succeeds; practice also requires observation')

for (const deadlineTick of [3000, 3250]) {
  poses = [rest, rest]
  const log = runCue({p1:'both',p2:'none'}, r => {
    now = 2999; poses[0] = up; r.tick(); now = deadlineTick
  })
  assert.equal(log.판정.P1.정답, false, 'A late tick must not extend the 250ms hold deadline')
}
let perfectScore = 0
for (const cmd of COMMANDS) {
  poses = [rest, rest]
  perfectScore += runCue(cmd.expect, r => {
    const asPose = action => ({ ...rest, leftRaised: action === 'left' || action === 'both', rightRaised: action === 'right' || action === 'both' })
    now = 1200; poses = [asPose(cmd.expect.p1), asPose(cmd.expect.p2)]; r.tick()
    now = 1450; r.tick()
  }).획득점수
}
assert.equal(perfectScore, 100)
poses = [rest, rest]
assert.equal(runCue({p1:'both',p2:'none'}, () => {}, r => { now = 500; poses[0] = up; r.tick() }).판정.P1.오류유형, '조급반응')
passed.push('A: all 20 correct commands still give 100; premature input and 1ms deadline spikes fail')

const { FanCounter, playerTaskResults } = load('src/game/gameB.ts')
const pair = [new FanCounter(), new FanCounter()]
function feed(counter, pose, t) { counter.update(pose,t); counter.update(pose,t+160) }
for (const [pose,t] of [[rest,0],[up,300],[rest,600],[up,900],[rest,1200]]) feed(pair[0],pose,t)
feed(pair[1],rest,0); feed(pair[1],up,300)
assert.deepEqual(plain(playerTaskResults('left',pair,2500,2)),[true,false])
pair[1] = new FanCounter(); feed(pair[1],rest,0); feed(pair[1],{...rest,leftRaised:true},300)
assert.deepEqual(plain(playerTaskResults('left',pair,2500,2)),[true,false])
pair[1] = new FanCounter(); feed(pair[1],rest,0); pair[1].update(rest,2500)
assert.deepEqual(plain(playerTaskResults('left',pair,2500,2)),[true,true])
pair[1].update({...rest,present:false},2600); pair[1].update(rest,3000)
assert.deepEqual(plain(playerTaskResults('left',pair,5500,2)),[true,false])
// The practice screen resets only the resting participant after a violation.
pair[1] = new FanCounter(); feed(pair[1],rest,6000); pair[1].update(rest,8200)
assert.deepEqual(plain(playerTaskResults('left',pair,8200,2)),[true,true])
const still = [new FanCounter(),new FanCounter()]
still.forEach(p=>{p.update(rest,0);p.update(rest,2500)})
assert.deepEqual(plain(playerTaskResults('big',still,2500,2)),[true,true])
still[1].update({...rest,handsTracked:false},2600)
assert.deepEqual(plain(playerTaskResults('big',still,2600,2)),[true,false])
passed.push('B: inactive full/partial movement and lost wrists fail; stillness and practice retry succeed')

let wall = 0
class ClockDate extends Date { static now() { return wall } }
let sampled = up
const batches = []
const { motionSampler } = load('src/game/motion.ts', { './pose': { poseEngine: { getPose: () => sampled } }, './telemetry': { logMotionWindows: rows => batches.push(...plain(rows)) } }, { Date: ClockDate })
motionSampler.start()
for (let sec=0;sec<3;sec++) {
  for(let tick=0;tick<20;tick++) motionSampler.sample()
  wall += 1000; motionSampler.closeWindow()
}
sampled = rest; motionSampler.sample(); sampled = up; motionSampler.sample()
wall += 500; motionSampler.stop()
assert.deepEqual(batches.filter(x=>x.actor_code==='P1').map(x=>x.rep_count),[2,0,0,2])
assert.equal(batches.filter(x=>x.actor_code==='P1').at(-1).cadence_spm,240)
const beforeLoss = batches.length
motionSampler.start()
sampled = rest; motionSampler.sample()
sampled = {...rest,present:false}; motionSampler.sample()
wall += 1000; motionSampler.closeWindow()
sampled = up; motionSampler.sample()
wall += 1000; motionSampler.stop()
assert.equal(batches.slice(beforeLoss).reduce((sum,w)=>sum+w.rep_count,0),0,'Reacquisition is not a new arm raise')
passed.push('Motion: held arms count once across windows; genuine new raises count; partial duration is respected')

const queueKey = 'bv.telemetry.queue.v1'
const rejectedKey = 'bv.telemetry.rejected.v1'
const response = (status=201,body='') => ({ok:status>=200&&status<300,status,text:async()=>body})
const settle = () => new Promise(resolve=>setImmediate(resolve))
function telemetry(fetch, data=new Map(), failStorage=false) {
  let id=0
  const deps = { './supabaseEnv': { SUPABASE_URL:'https://audit.invalid',SUPABASE_KEY:'fake-only' }, './auth': { currentPlayerCodes:()=>['01','02'],currentSiteCode:()=>'audit' } }
  return {data, api:load('src/game/telemetry.ts',deps,{
    console:{warn(){}}, fetch, crypto:{randomUUID:()=>`audit-${++id}`},
    localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(failStorage)throw new Error('quota');data.set(key,value)}},
  })}
}
const startInfo = {gameKey:'orak_flag',appVersion:'audit',inputMode:'키보드'}
const endInfo = {completed:false,teamScore:0,maxScore:100,commandsPlayed:0}
const data = new Map([[queueKey,JSON.stringify([{kind:'insert',table:'session',rows:[{session_id:'old'}]}])]])
const sent=[]; let release
const q = telemetry((url,init)=>{sent.push({url,body:JSON.parse(init.body)});return sent.length===1?new Promise(r=>{release=r}):Promise.resolve(response())},data)
const flushing = q.api.flushQueue()
q.api.startSession(startInfo)
assert.equal(JSON.parse(data.get(queueKey)).length,2)
release(response()); await flushing
assert.equal(sent.length,2)
assert.equal(sent[1].body[0].game_key,'orak_flag')
assert.equal(JSON.parse(data.get(queueKey)).length,0)
passed.push('Queue: legacy pending record migrates; enqueue during in-flight send is delivered without loss')

for (const failStorage of [false,true]) {
  const calls=[]; let releaseInsert
  const order = telemetry((url,init)=>{
    calls.push({path:url.split('/').at(-1),body:JSON.parse(init.body),prefer:init.headers.Prefer})
    return calls.length===1?new Promise(r=>{releaseInsert=r}):Promise.resolve(response(200,'true'))
  },new Map(),failStorage)
  order.api.startSession(startInfo); order.api.endSession(endInfo)
  assert.deepEqual(calls.map(x=>x.path),['session'])
  releaseInsert(response()); await settle()
  assert.deepEqual(calls.map(x=>x.path),['session','close_session'])
  assert.equal(calls[0].body[0].session_id,calls[1].body.p_session_id)
  assert.match(calls[0].prefer,/ignore-duplicates/)
}
passed.push('Queue: session must finish inserting before close; memory fallback preserves order when storage is full')

let online=false
const offlineCalls=[]
const offline = telemetry(async(url,init)=>{offlineCalls.push(url.split('/').at(-1));return online?response(200,'true'):response(503)})
offline.api.startSession(startInfo); offline.api.endSession(endInfo); await settle()
assert.equal(JSON.parse(offline.data.get(queueKey)).length,2)
online=true; await offline.api.flushQueue()
assert.deepEqual(offlineCalls,['session','session','close_session'])
assert.equal(JSON.parse(offline.data.get(queueKey)).length,0)

let closeOK=false
const ambiguous = telemetry(async url=>response(200,url.endsWith('close_session')?(closeOK?'true':'false'):''))
ambiguous.api.startSession(startInfo); ambiguous.api.endSession(endInfo); await settle()
assert.equal(JSON.parse(ambiguous.data.get(queueKey)).length,1)
closeOK=true; await ambiguous.api.flushQueue()
assert.equal(JSON.parse(ambiguous.data.get(queueKey)).length,0)
const rejected = telemetry(async url=>response(200,url.endsWith('close_session')?'false':''))
rejected.api.startSession(startInfo); rejected.api.endSession(endInfo); await settle()
await rejected.api.flushQueue(); await rejected.api.flushQueue()
assert.equal(JSON.parse(rejected.data.get(queueKey)).length,0)
assert.equal(JSON.parse(rejected.data.get(rejectedKey))[0].pending.fn,'close_session')
const throttled = telemetry(async()=>response(429))
throttled.api.startSession(startInfo); await settle()
assert.equal(JSON.parse(throttled.data.get(queueKey)).length,1)
const denied = telemetry(async()=>response(403,'denied'))
denied.api.startSession(startInfo); await settle()
assert.equal(JSON.parse(denied.data.get(rejectedKey))[0].pending.table,'session')
const largeBacklog = new Map([[queueKey,JSON.stringify(Array.from({length:205},(_,i)=>({kind:'insert',table:'session',rows:[{session_id:`old-${i}`}]})))]])
const backlog = telemetry(async()=>response(503),largeBacklog)
backlog.api.startSession(startInfo); await settle()
assert.equal(JSON.parse(largeBacklog.get(queueKey)).length,206,'Long outages must not truncate parent session records')
passed.push('Queue: offline/429 retry; ambiguous close retries; persistent rejection is retained separately')

let resolveCamera; let modelCreates=0
const cameraGate = new Promise(resolve=>{resolveCamera=resolve})
const { handEngine } = load('src/game/hand.ts', {
  './handGrip': load('src/game/handGrip.ts'),
  '@mediapipe/tasks-vision': {FilesetResolver:{forVisionTasks:async()=>({})},GestureRecognizer:{createFromOptions:async()=>{modelCreates++;return {recognizeForVideo:()=>({gestures:[]})}}}},
  './camera':{openCamera:()=>cameraGate,cameraReady:()=>false,cameraVideo:()=>null},
  './pose':{poseEngine:{pointer:()=>({visible:false,x:.5,y:.5})}},
}, {document:{createElement:()=>({getContext:()=>null})}}, {BASE_URL:'/'})
const first = handEngine.start(1000,()=>{})
const second = handEngine.start(1000,()=>{})
handEngine.stop(); resolveCamera({videoWidth:1280,videoHeight:720})
assert.deepEqual(await Promise.all([first,second]),[false,false])
assert.equal(handEngine.status().running,false)
assert.equal(modelCreates,1)
assert.equal(await handEngine.start(1000,()=>{}),true)
assert.equal(handEngine.status().running,true)
handEngine.stop()
passed.push('Hand: cancelled starts stay stopped; overlapping starts share one model; later restart works')

const listeners=new Map(); const documentListeners=new Map(); const doc={hidden:false,addEventListener:(key,fn)=>documentListeners.set(key,fn)}
const { poseEngine } = load('src/game/pose.ts',{'@mediapipe/tasks-vision':{},'./camera':{},'./playerFrame':load('src/game/playerFrame.ts')},{window:{addEventListener:(key,fn)=>listeners.set(key,fn)},document:doc})
listeners.get('keydown')({key:'q'})
assert.equal(poseEngine.getPose(1).leftRaised,true)
listeners.get('blur')()
assert.equal(poseEngine.getPose(1).leftRaised,false)
listeners.get('keydown')({key:'w'}); doc.hidden=true; documentListeners.get('visibilitychange')()
assert.equal(poseEngine.getPose(1).rightRaised,false)
listeners.get('keydown')({key:'p',target:{tagName:'INPUT'}})
assert.equal(poseEngine.getPose(2).rightRaised,false)
listeners.get('keydown')({key:'o'}); poseEngine.setMode('game')
assert.equal(poseEngine.getPose(2).leftRaised,false)
poseEngine.ready=true; poseEngine.cameraOk=false
assert.equal(poseEngine.getPose(1).present,true)
assert.equal(poseEngine.getPose(2).handsTracked,true)
poseEngine.cameraOk=true
poseEngine.pose[1]={...up}; poseEngine.riceSamples[1]={at:0,tracked:true}
assert.equal(poseEngine.getPose(1).present,false,'Stale camera samples are not current presence')
passed.push('Pose: blur/hidden/mode reset backup keys; forms do not control games; fallback rest is valid; stale camera input expires')

{
  const { buildSessionLog } = load('src/game/logging.ts', { './commands': { COMMANDS } })
  const metadata = { startedAt: '2026-09-30T01:02:03.000Z', inputMode: '키보드' }
  const avatars = { p1: 'grandma', p2: 'grandfa' }
  const first = buildSessionLog([], 0, avatars, metadata)
  const again = buildSessionLog([], 0, avatars, metadata)
  assert.equal(first.시작시각, metadata.startedAt)
  assert.equal(again.시작시각, first.시작시각)
  assert.equal(first.입력모드, metadata.inputMode)
  const rows = []
  const recorded = telemetry(async (url, init) => { rows.push({ url, body: JSON.parse(init.body) }); return response() })
  recorded.api.startSession({ ...startInfo, startedAt: metadata.startedAt })
  poses = [rest, rest]
  const log = runCue({ p1: 'none', p2: 'none' })
  log.구령시작시각 = '2026-09-30T01:02:04.000Z'
  recorded.api.logCommand(log, { contentId: 'test', index: 0 })
  await settle()
  assert.equal(rows[0].body[0].started_at, metadata.startedAt)
  assert.deepEqual(rows[1].body.map(row => row.onset_ts), [log.구령시작시각, log.구령시작시각])
  passed.push('A timestamps: local export, session insert and both player trials retain captured onset times')
}
{
  poses = [rest, rest]
  const accepted = runCue({ p1: 'both', p2: 'none' }, runner => {
    now = 1200; poses = [up, rest]; runner.tick()
    now = 1450; runner.tick()
    now = 1500; poses = [rest, rest]; runner.tick()
    runner.resetPartialInput()
  })
  assert.equal(accepted.획득점수, 5, 'A accepted raise survives pause even after the hands were lowered')
  assert.equal(accepted.판정.P1.반응속도ms, 200)
  poses = [rest, rest]
  const unfinished = runCue({ p1: 'both', p2: 'none' }, runner => {
    now = 1200; poses = [up, rest]; runner.tick(); runner.resetPartialInput()
    now = 1600; runner.tick()
  })
  assert.equal(unfinished.판정.P1.정답, false, 'A partial hold spanning pause needs a fresh raise')
  const counter = new FanCounter()
  feed(counter, rest, 0); feed(counter, up, 300); feed(counter, rest, 600)
  feed(counter, up, 900); counter.resetPartial(); feed(counter, rest, 1200)
  assert.equal(counter.count, 1, 'Returning after a pause must not complete the pre-pause half-cycle')
  feed(counter, up, 1500); feed(counter, rest, 1800); assert.equal(counter.count, 2)
  assert.equal(counter.restViolated, true, 'A pause does not erase an observed rule violation')
  const { RiceActionTracker } = load('src/game/gameC.ts')
  const rice = new RiceActionTracker('squeeze', 0)
  const input = { tracked: true, left: false, right: false, grip: 'open' }
  const grip = (value, t) => { rice.update({ ...input, grip: value }, t); rice.update({ ...input, grip: value }, t + 160) }
  grip('open', 0); grip('closed', 300); grip('open', 600)
  grip('closed', 900); rice.resetPartial(); grip('open', 1200)
  assert.equal(rice.count, 1)
  grip('closed', 1500); grip('open', 1800); grip('closed', 2100); grip('open', 2400)
  assert.equal(rice.count, 3); assert.equal(rice.complete, true)
  poseEngine.cameraOk = false; poseEngine.setKeyboardPaused(true)
  listeners.get('keydown')({ key: 'q' }); assert.equal(poseEngine.getPose(1).leftRaised, false)
  poseEngine.setKeyboardPaused(false); listeners.get('keydown')({ key: 'q', repeat: true })
  assert.equal(poseEngine.getPose(1).leftRaised, false)
  listeners.get('keydown')({ key: 'q' }); assert.equal(poseEngine.getPose(1).leftRaised, true)
  const beforeResume = batches.length
  sampled = up; motionSampler.start(true); motionSampler.sample(); wall += 500; motionSampler.stop()
  assert.equal(batches.slice(beforeResume).reduce((sum, row) => sum + row.rep_count, 0), 0)
  passed.push('Pause input: B/C preserve full repetitions, discard partial cycles; held keys and motion resume cannot add repetitions')
}
console.log(JSON.stringify({status:'passed',groups:passed.length,checks:passed},null,2))
