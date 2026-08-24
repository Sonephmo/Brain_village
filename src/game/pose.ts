// MediaPipe PoseLandmarker 래퍼.
//
// 2인 인식은 numPoses:2 대신 **프레임 좌/우 분할 + 각 영역 단일 포즈 추정**(스펙 §4.1).
// 플레이어 귀속이 물리적으로 보장되고 ID 스왑이 원천 차단된다.
//
// 좌표 규약 (헷갈리기 쉬우므로 명시):
//  - 카메라는 참가자를 마주 보므로 원본 프레임은 좌우가 뒤집혀 있다.
//    화면 왼쪽에 선 1P는 **원본 프레임의 오른쪽 절반**에 찍힌다.
//  - 화면은 거울 모드(scaleX(-1))라 참가자가 보기에 자기 위치와 일치한다.
//  - MediaPipe 랜드마크의 LEFT/RIGHT는 **본인 기준**이다(LEFT_WRIST = 참가자의 실제 왼손).
//    거울 모드에서 참가자의 왼손은 화면 왼쪽에 보이므로 그대로 쓰면 된다.
//  - 화면 대조가 필요한 좌표(얼굴 위치)는 mirror 처리한 screenX로 따로 제공한다.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { cameraError, cameraStream, openCamera } from './camera'
import type { PlayerId, PlayerPose, Hand } from './types'

const NOSE = 0
const L_SHOULDER = 11
const R_SHOULDER = 12
const L_HIP = 23
const R_HIP = 24
const L_WRIST = 15
const R_WRIST = 16

/** 이 값 미만의 랜드마크는 신뢰하지 않는다 (가려짐·프레임 이탈) */
const VIS_MIN = 0.5
/** 몸통(코·양어깨) 평균 신뢰도가 이 값을 넘어야 '사람이 있다'로 본다 */
const PRESENCE_MIN = 0.6
/** 임계선 부근 떨림을 막는 히스테리시스 폭 (정규화 y) */
const HYSTERESIS = 0.02
/** 캘리브레이션 전 임시 기준: 어깨보다 이만큼 위 */
const FALLBACK_MARGIN = 0.12
/** 손목이 이 프레임 수만큼 연속으로 신뢰 불가면 내려간 것으로 처리 */
const LOST_FRAMES = 6

const RIGHT_WRIST = 16 // = R_WRIST. 포인터(커서) 기준점

/**
 * 커서 활성 영역. 손을 화면 끝까지 뻗기 어려우므로 프레임의 가운데만 화면 전체에 대응시킨다.
 * **부스에서 카메라 화각·참가자 거리에 맞춰 조정할 값이다.**
 */
const POINTER_ACTIVE = { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.85 }
/** 커서 떨림을 줄이는 지수 평활 계수 */
const POINTER_SMOOTH = 0.35

/**
 * 인식 모드.
 *  - `menu`: 전체 프레임 1회 추론. 커서만 필요한 화면(타이틀·마을·결과)에서 쓴다.
 *  - `game`: 좌/우 절반 2회 추론. 2인 동작 판정이 필요한 화면에서 쓴다.
 *            커서는 이미 계산된 1P 손목을 재사용하므로 추가 비용이 없다.
 */
export type PoseMode = 'menu' | 'game'

export interface PointerState {
  visible: boolean
  x: number
  y: number
}

type Landmark = { x: number; y: number; z: number; visibility?: number }

interface Calib {
  /** 캘리브레이션 중 모은 손목 y 표본 (작을수록 높이 든 것) */
  samples: { left: number[]; right: number[] }
  shoulderSamples: number[]
  threshold: { left: number; right: number } | null
}

function emptyPose(): PlayerPose {
  return {
    present: false,
    noseX: null,
    noseY: null,
    screenX: null,
    leftRaised: false,
    rightRaised: false,
    leftWristY: null,
    rightWristY: null,
    shoulderY: null,
  }
}

function freshCalib(): Calib {
  return { samples: { left: [], right: [] }, shoulderSamples: [], threshold: null }
}

/** 표본의 하위 p분위 (y는 작을수록 높으므로, 최고 도달점은 낮은 분위에서 찾는다) */
function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]
}

function median(arr: number[]): number | null {
  return percentile(arr, 0.5)
}

class PoseEngine {
  stream: MediaStream | null = null
  cameraOk = false
  keyboardMode = false
  ready = false
  initError: string | null = null
  /** 실제로 쓰인 추론 백엔드 (GPU 실패 시 CPU로 내려간다) */
  delegate: 'GPU' | 'CPU' | null = null

  private video: HTMLVideoElement | null = null
  private landmarkers: [PoseLandmarker, PoseLandmarker] | null = null
  private halves: [HTMLCanvasElement, HTMLCanvasElement] | null = null
  private fullCanvas: HTMLCanvasElement | null = null
  private mode: PoseMode = 'menu'
  /** 커서 원천이 되는 오른손 손목 (menu는 전체 프레임, game은 1P 반쪽 기준) */
  private wrist: { x: number; y: number } | null = null
  private wristLost = LOST_FRAMES
  private ptr = { x: 0.5, y: 0.5, has: false }
  private raf = 0
  private watchdog = 0
  private lastTs = 0
  private lastDetectTs: [number, number] = [0, 0]
  private fps = 0
  private pose: Record<PlayerId, PlayerPose> = { 1: emptyPose(), 2: emptyPose() }
  private calib: Record<PlayerId, Calib> = { 1: freshCalib(), 2: freshCalib() }
  private calibrating = false
  /** 히스테리시스용 현재 상태 + 손목 유실 카운터 */
  private raised: Record<PlayerId, { left: boolean; right: boolean }> = {
    1: { left: false, right: false },
    2: { left: false, right: false },
  }
  private lost: Record<PlayerId, { left: number; right: number }> = {
    1: { left: 0, right: 0 },
    2: { left: 0, right: 0 },
  }
  private keys: Record<PlayerId, { left: boolean; right: boolean }> = {
    1: { left: false, right: false },
    2: { left: false, right: false },
  }

  constructor() {
    window.addEventListener('keydown', e => this.onKey(e, true))
    window.addEventListener('keyup', e => this.onKey(e, false))
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const map: Record<string, [PlayerId, Hand]> = {
      q: [1, 'left'],
      w: [1, 'right'],
      o: [2, 'left'],
      p: [2, 'right'],
    }
    const hit = map[e.key.toLowerCase()]
    if (!hit) return
    this.keys[hit[0]][hit[1]] = down
    if (down) this.keyboardMode = true
  }

  async init(): Promise<void> {
    if (this.ready || this.initError) return
    try {
      // 카메라는 camera.ts가 소유한다. 타이틀의 손 인식이 이미 열어 뒀으면 그대로 쓴다.
      const video = await openCamera()
      if (!video) throw new Error(cameraError() ?? 'camera unavailable')
      this.stream = cameraStream()
      this.video = video

      const base = import.meta.env.BASE_URL
      const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
      const make = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
      try {
        this.landmarkers = [await make('GPU'), await make('GPU')]
        this.delegate = 'GPU'
      } catch {
        // 부스 PC에 GPU 가속이 없거나 드라이버가 막힌 경우 CPU로 내려간다
        this.landmarkers = [await make('CPU'), await make('CPU')]
        this.delegate = 'CPU'
      }

      // 캔버스는 반쪽 프레임의 **비율을 그대로** 유지해야 한다.
      // 늘리면 몸 비율이 왜곡되어 어깨 대비 손목 높이(임계선)가 어긋난다.
      const halfW = Math.round(video.videoWidth / 2) || 640
      const halfH = video.videoHeight || 720
      const scale = Math.min(1, 480 / halfH) // 추론 비용을 줄이되 비율은 유지
      const cw = Math.max(64, Math.round(halfW * scale))
      const ch = Math.max(64, Math.round(halfH * scale))
      const mk = (w: number, h: number) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        return c
      }
      // halves[0]은 game 모드에서 1P 반쪽, menu 모드에서는 전체 프레임을 담는다.
      // 전체 프레임은 가로가 2배라 비율이 달라 별도 캔버스를 쓴다
      // (늘리면 몸 비율이 왜곡되어 임계선이 어긋난다).
      this.halves = [mk(cw, ch), mk(cw, ch)]
      this.fullCanvas = mk(Math.min(960, cw * 2), ch)

      // 첫 추론은 GPU 파이프라인이 차가워 수 초가 걸린다(실측 최대 4.9초).
      // 튜토리얼 도중에 그 비용을 치르면 인식이 멈춘 것처럼 보이므로 여기서 미리 데운다.
      const warm = document.createElement('canvas')
      warm.width = cw
      warm.height = ch
      const wg = warm.getContext('2d')
      if (wg) {
        wg.fillStyle = '#808080'
        wg.fillRect(0, 0, cw, ch)
        for (let i = 0; i < 2; i++) {
          try {
            const ts = performance.now() + i
            this.lastDetectTs[i] = ts
            this.landmarkers[i].detectForVideo(warm, ts)
          } catch {
            /* 워밍업 실패는 무시 (다음 프레임에 정상화된다) */
          }
        }
      }

      this.cameraOk = true
      this.ready = true
      this.loop()
      // rAF는 창이 가려지면 멈춘다 → 인터벌로 이어받는다 (부스 안전장치)
      this.watchdog = window.setInterval(() => {
        if (performance.now() - this.lastTs > 200) this.detectOnce()
      }, 100)
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err)
      this.keyboardMode = true
      this.ready = true // 키보드 모드로는 진행 가능
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.detectOnce()
  }

  private detectOnce() {
    const v = this.video
    if (!v || !this.landmarkers || !this.halves || v.readyState < 2) return
    const now = performance.now()
    if (now - this.lastTs < 33) return // ~30fps
    const dt = now - this.lastTs
    this.lastTs = now
    if (dt < 1000) this.fps = this.fps ? this.fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt

    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return

    if (this.mode === 'menu') {
      // 커서만 필요한 화면: 전체 프레임 1회 추론 (절반씩 두 번 돌릴 이유가 없다)
      const canvas = this.fullCanvas
      if (!canvas) return
      const g = canvas.getContext('2d', { willReadFrequently: false })
      if (!g) return
      g.drawImage(v, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height)
      const ts = Math.max(now, this.lastDetectTs[0] + 1)
      this.lastDetectTs[0] = ts
      try {
        const res = this.landmarkers[0].detectForVideo(canvas, ts)
        const lm = (res.landmarks?.[0] as Landmark[] | undefined) ?? null
        const w = lm?.[RIGHT_WRIST]
        this.updatePointer(w && (w.visibility ?? 0) >= VIS_MIN ? w : null)
      } catch {
        /* 다음 프레임에 회복된다 */
      }
      return
    }

    // 1P(화면 왼쪽) = 원본 오른쪽 절반, 2P = 원본 왼쪽 절반
    const srcX: Record<PlayerId, number> = { 1: vw / 2, 2: 0 }
    for (const pid of [1, 2] as PlayerId[]) {
      const canvas = this.halves[pid - 1]
      const g = canvas.getContext('2d', { willReadFrequently: false })
      if (!g) continue
      g.drawImage(v, srcX[pid], 0, vw / 2, vh, 0, 0, canvas.width, canvas.height)
      // 같은 landmarker에 같은(또는 더 이른) 타임스탬프를 주면 예외가 난다
      const ts = Math.max(now, this.lastDetectTs[pid - 1] + 1)
      this.lastDetectTs[pid - 1] = ts
      try {
        const res = this.landmarkers[pid - 1].detectForVideo(canvas, ts)
        const lm = (res.landmarks?.[0] as Landmark[] | undefined) ?? null
        this.applyResult(pid, lm)
        // 커서는 1P의 오른손 손목을 재사용한다 → 추가 추론 비용이 없다
        if (pid === 1) {
          const w = lm?.[RIGHT_WRIST]
          this.updatePointer(w && (w.visibility ?? 0) >= VIS_MIN ? w : null)
        }
      } catch {
        /* 개별 프레임 추론 실패는 다음 프레임에 회복된다 */
      }
    }
  }

  /** 손목 좌표 → 거울 보정 + 활성 영역 확대 + 평활 */
  private updatePointer(w: { x: number; y: number } | null) {
    if (!w) {
      if (++this.wristLost >= LOST_FRAMES) this.ptr.has = false
      return
    }
    this.wristLost = 0
    this.wrist = { x: w.x, y: w.y }
    const px = 1 - w.x // 거울 모드
    const nx = Math.min(1, Math.max(0, (px - POINTER_ACTIVE.x0) / (POINTER_ACTIVE.x1 - POINTER_ACTIVE.x0)))
    const ny = Math.min(1, Math.max(0, (w.y - POINTER_ACTIVE.y0) / (POINTER_ACTIVE.y1 - POINTER_ACTIVE.y0)))
    if (!this.ptr.has) {
      this.ptr.x = nx
      this.ptr.y = ny
      this.ptr.has = true
    } else {
      this.ptr.x += (nx - this.ptr.x) * POINTER_SMOOTH
      this.ptr.y += (ny - this.ptr.y) * POINTER_SMOOTH
    }
  }

  /** 화면 정규화 커서 좌표 (0~1). 손목이 안 잡히면 visible=false */
  pointer(): PointerState {
    return { visible: this.ptr.has, x: this.ptr.x, y: this.ptr.y }
  }

  /**
   * 인식 모드 전환. 커서만 필요한 화면은 'menu'(1회 추론), 2인 판정이 필요한
   * 화면은 'game'(2회 추론)으로 둔다.
   */
  setMode(mode: PoseMode) {
    if (this.mode === mode) return
    this.mode = mode
    this.ptr.has = false
    this.wristLost = LOST_FRAMES
  }

  private applyResult(pid: PlayerId, lm: Landmark[] | null) {
    const p = this.pose[pid]
    const vis = (i: number) => lm?.[i]?.visibility ?? 0

    // 사람이 있는지: 코 + 양어깨 신뢰도로 판단.
    // 랜드마크는 사람이 없어도 항상 33개가 오므로 이 게이트가 없으면 유령 입력이 생긴다.
    const presence = lm ? (vis(NOSE) + vis(L_SHOULDER) + vis(R_SHOULDER)) / 3 : 0
    if (!lm || presence < PRESENCE_MIN) {
      p.present = false
      p.noseX = p.noseY = p.screenX = null
      p.shoulderY = p.leftWristY = p.rightWristY = null
      this.raised[pid].left = false
      this.raised[pid].right = false
      p.leftRaised = false
      p.rightRaised = false
      return
    }

    const nose = lm[NOSE]
    const shoulderY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2

    p.present = true
    p.noseX = nose.x
    p.noseY = nose.y
    // 화면은 거울 모드라, 화면상의 가로 위치는 좌우를 뒤집어야 한다
    p.screenX = 1 - nose.x
    p.shoulderY = shoulderY

    // 몸통 크기로 정규화하면 참가자가 앞뒤로 움직여도 임계선이 덜 흔들린다
    const hipY = (lm[L_HIP].y + lm[R_HIP].y) / 2
    const torso = Math.max(0.05, hipY - shoulderY)

    const c = this.calib[pid]
    if (this.calibrating) {
      c.shoulderSamples.push(shoulderY)
      if (vis(L_WRIST) >= VIS_MIN) c.samples.left.push(lm[L_WRIST].y)
      if (vis(R_WRIST) >= VIS_MIN) c.samples.right.push(lm[R_WRIST].y)
    }

    for (const hand of ['left', 'right'] as Hand[]) {
      const idx = hand === 'left' ? L_WRIST : R_WRIST
      const wristY = lm[idx].y
      if (hand === 'left') p.leftWristY = wristY
      else p.rightWristY = wristY

      // 손목이 안 보이면 즉시 내리지 않고 몇 프레임 유예한다 (일시적 가려짐 대비)
      if (vis(idx) < VIS_MIN) {
        if (++this.lost[pid][hand] >= LOST_FRAMES) this.raised[pid][hand] = false
        continue
      }
      this.lost[pid][hand] = 0

      const base = c.threshold ? c.threshold[hand] : shoulderY - FALLBACK_MARGIN
      const margin = HYSTERESIS * (torso / 0.25) // 몸통 크기에 비례한 여유
      // y는 위로 갈수록 작다: 올리려면 임계선보다 확실히 위, 내리려면 확실히 아래
      this.raised[pid][hand] = this.raised[pid][hand]
        ? wristY < base + margin
        : wristY < base - margin
    }

    p.leftRaised = this.raised[pid].left
    p.rightRaised = this.raised[pid].right
  }

  getPose(pid: PlayerId): PlayerPose {
    // 키보드 입력은 항상 반영 (카메라 유무와 무관한 진행요원용 예비 입력)
    const p = { ...this.pose[pid] }
    const k = this.keys[pid]
    p.leftRaised = p.leftRaised || k.left
    p.rightRaised = p.rightRaised || k.right
    if (k.left || k.right) p.present = true
    return p
  }

  /** 캘리브레이션 시작: 표본 수집 */
  startCalibration() {
    this.calib = { 1: freshCalib(), 2: freshCalib() }
    this.calibrating = true
  }

  /**
   * 캘리브레이션 종료: 개인 최대 도달 높이의 75% 지점을 임계선으로 확정 (스펙 §4.1).
   * 절대 최솟값을 쓰면 튄 프레임 하나가 도달 불가능한 임계선을 만들므로,
   * 상위 10% 분위를 최대 도달점으로 본다.
   */
  finishCalibration() {
    this.calibrating = false
    for (const pid of [1, 2] as PlayerId[]) {
      const c = this.calib[pid]
      const shoulderY = median(c.shoulderSamples)
      if (shoulderY == null) {
        c.threshold = null // 표본이 없으면 임시 기준을 계속 쓴다
        continue
      }
      const th = { left: shoulderY - FALLBACK_MARGIN, right: shoulderY - FALLBACK_MARGIN }
      for (const hand of ['left', 'right'] as Hand[]) {
        const top = percentile(c.samples[hand], 0.1)
        if (top == null) continue
        const reach = shoulderY - top
        if (reach > 0.05) th[hand] = shoulderY - reach * 0.75
      }
      c.threshold = th
    }
  }

  /** 캘리브레이션 중 양손이 어깨 위인지 (진행 게이지용) */
  bothHandsUpRaw(pid: PlayerId): boolean {
    const k = this.keys[pid]
    if (k.left && k.right) return true
    const p = this.pose[pid]
    if (!p.present || p.leftWristY == null || p.rightWristY == null || p.shoulderY == null) return false
    return p.leftWristY < p.shoulderY - 0.05 && p.rightWristY < p.shoulderY - 0.05
  }

  /** 부스 점검용 상태 (카메라·백엔드·프레임률·임계선) */
  status() {
    return {
      cameraOk: this.cameraOk,
      keyboardMode: this.keyboardMode,
      delegate: this.delegate,
      error: this.initError,
      fps: Math.round(this.fps),
      resolution: this.video ? [this.video.videoWidth, this.video.videoHeight] : null,
      canvas: this.halves ? [this.halves[0].width, this.halves[0].height] : null,
      present: { 1: this.pose[1].present, 2: this.pose[2].present },
      threshold: { 1: this.calib[1].threshold, 2: this.calib[2].threshold },
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    window.clearInterval(this.watchdog)
    // 스트림은 camera.ts 소유이므로 여기서 멈추지 않는다 (다른 화면이 쓸 수 있다)
    this.landmarkers?.forEach(l => l.close())
    this.landmarkers = null
    this.stream = null
    this.video = null
    this.ready = false
    this.cameraOk = false
  }
}

export const poseEngine = new PoseEngine()

// 개발 중 부스 점검용 훅 (프로덕션 빌드에는 포함되지 않는다)
if (import.meta.env.DEV) {
  ;(window as unknown as { __pose?: unknown }).__pose = poseEngine
}
