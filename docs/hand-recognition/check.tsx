import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { inspectHand, type HandGrip } from '../../src/game/handGrip'
import { ShoppingGripTracker } from '../../src/game/gameD'
import { RiceActionTracker } from '../../src/game/gameC'
import { shoppingGripEngine } from '../../src/game/gameDGrip'
import { riceGripEngine } from '../../src/game/gameCGrip'
import { poseEngine } from '../../src/game/pose'
import { cameraStream, closeCamera } from '../../src/game/camera'
import type { PlayerId } from '../../src/game/types'
import './style.css'
const names: Record<HandGrip, string> = { open: '활짝 편 손', closed: '쥔 손', closing: '손을 움직이는 중', unknown: '두 손을 보여 주세요' }
function Check() {
  const [report, setReport] = useState<any>(null), [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false), [mode, setMode] = useState('shopping')
  const [live, setLive] = useState<any>(null), video = useRef<HTMLVideoElement>(null)
  const sample = async () => {
    setBusy(true); setReport(null)
    let model: GestureRecognizer | undefined
    try {
      const fileset = await FilesetResolver.forVisionTasks('/wasm')
      model = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'GPU' }, runningMode: 'IMAGE', numHands: 2 })
      const tests = []
      for (const [file, expected] of [['fist.png', 'closed'], ['right_hands.jpg', 'open']]) {
        const image = new Image(); image.src = './fixtures/' + file; await image.decode()
        const result = model.recognize(image)
        const hands = result.landmarks.map((landmarks, i) => ({
          gesture: result.gestures[i]?.[0],
          // Removing the canned name proves the actual detected joints can carry classification.
          classified: inspectHand({ landmarks, worldLandmarks: result.worldLandmarks[i], gesture: result.gestures[i]?.[0] }, image.width / image.height),
          withoutCategory: inspectHand({ landmarks, worldLandmarks: result.worldLandmarks[i] }, image.width / image.height),
          landmarks, worldLandmarks: result.worldLandmarks[i],
        }))
        tests.push({ file, expected, count: hands.length, passed: hands.length === (file === 'fist.png' ? 1 : 2) && hands.every(hand => hand.classified.grip === expected && hand.withoutCategory.grip === expected), hands })
      }
      setReport({ passed: tests.every(test => test.passed), tests })
    } catch (error) { setReport({ error: String(error) }) }
    finally { model?.close(); setBusy(false) }
  }
  const start = async () => {
    setBusy(true)
    try { await poseEngine.init(); poseEngine.setMode('game'); setRunning(true) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!running) return
    if (video.current) { video.current.srcObject = cameraStream(); void video.current.play() }
    shoppingGripEngine.reset(); riceGripEngine.reset()
    const trackers = { 1: new ShoppingGripTracker(), 2: new ShoppingGripTracker() }
    const rice = { 1: new RiceActionTracker('squeeze', performance.now()), 2: new RiceActionTracker('squeeze', performance.now()) }
    const counts = { 1: 0, 2: 0 }
    if (mode === 'shopping') void shoppingGripEngine.init(); else void riceGripEngine.init()
    const timer = window.setInterval(() => {
      const now = performance.now(), grips: Record<PlayerId, HandGrip> = { 1: 'unknown', 2: 'unknown' }
      if (mode === 'shopping') {
        const frame = shoppingGripEngine.sample(now)
        for (const pid of [1, 2] as const) {
          grips[pid] = poseEngine.getPose(pid).present ? frame.grips[pid] : 'unknown'
          if (trackers[pid].update(grips[pid], frame.at)) counts[pid]++
        }
      } else {
        const pid = Number(mode) as PlayerId
        grips[pid] = riceGripEngine.sample(pid, now)
        rice[pid].update({ tracked: poseEngine.getPose(pid).present && grips[pid] !== 'unknown', left: false, right: false, aboveHead: false, grip: grips[pid] }, now)
        counts[pid] = rice[pid].count
      }
      setLive({ grips, counts: { ...counts }, engine: mode === 'shopping' ? shoppingGripEngine.status() : riceGripEngine.status(), camera: poseEngine.status() })
    }, 50)
    return () => window.clearInterval(timer)
  }, [running, mode])
  useEffect(() => () => { poseEngine.destroy(); closeCamera() }, [])
  return <main><h1>손 인식 점검</h1><p>팔은 보이는데 잼잼이 안 될 때, 손 인식 상태와 횟수를 따로 확인합니다. 영상은 저장하거나 전송하지 않습니다.</p>
    <div className="controls"><button disabled={busy || running} onClick={sample}>샘플 사진 검사</button><button disabled={busy || running} onClick={start}>카메라로 검사 시작</button>
      {running && <button onClick={() => { setRunning(false); poseEngine.destroy(); closeCamera() }}>카메라 끄기</button>}
      <label>검사할 게임 <select value={mode} onChange={event => setMode(event.target.value)}><option value="shopping">장보기 · 두 참가자</option><option value="1">떡방아 · 왼쪽 참가자</option><option value="2">떡방아 · 오른쪽 참가자</option></select></label></div>
    {busy && <p role="status">인식 모델을 준비하고 있습니다…</p>}
    {running && <><p>청기백기와 같은 좌우 구역으로 인식합니다. 몸과 두 손을 같은 구역 안에 두고, 양손을 편 뒤 함께 쥐었다 다시 펴 주세요. 혼자서도 한쪽을 점검할 수 있습니다.</p>
      <div className="camera"><video ref={video} muted playsInline /><span /><b className="p1">1P · 왼쪽</b><b className="p2">2P · 오른쪽</b></div>
      <div className="players">{([1, 2] as const).map(pid => <section key={pid}><h2>{pid === 1 ? '왼쪽' : '오른쪽'} 참가자</h2><p>{names[live?.grips[pid] ?? 'unknown']}</p><strong>{live?.counts[pid] ?? 0}회</strong>
        <p>몸: {live?.camera.present[pid] ? '보임' : '안 보임'} · 손: {live?.engine.players?.[pid]?.hands ?? 0}/2개</p>
        <small>손 추론: {live?.engine.players?.[pid]?.inferenceMs ?? 0}ms · 입력: {live?.engine.players?.[pid]?.resolution?.join(' × ') ?? '준비 중'}</small>
      </section>)}</div>
      <p>인식한 손: {live?.engine.hands ?? 0}개 · 모델: {live?.engine.ready ? '준비됨' : '준비 중'} · {live?.engine.error ?? live?.camera.error ?? ''}</p>
      <p>몸 인식: 왼쪽 {live?.camera.present[1] ? '보임' : '안 보임'} / 오른쪽 {live?.camera.present[2] ? '보임' : '안 보임'}</p></>}
    {report && <><h2 role="status">{report.passed ? '샘플 검사 통과' : '샘플 검사 확인 필요'}</h2><div className="samples">{report.tests?.map((test: any) => <section key={test.file}><img src={'./fixtures/' + test.file} alt={test.expected === 'open' ? '편 손 샘플' : '주먹 샘플'} /><p>{test.file}: {test.count}개 손 · {test.passed ? '통과' : '실패'}</p></section>)}</div><details><summary>검사 결과 자세히</summary><pre id="sample-report">{JSON.stringify(report, null, 2)}</pre></details></>}
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Check />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
