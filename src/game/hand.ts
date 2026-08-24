// 손으로 화면을 조작하는 포인터.
//
// 역할을 두 모델로 나눈다.
//  - **위치**: PoseLandmarker의 오른손 손목(RIGHT_WRIST). 손 랜드마커는 멀리 있는 손을
//    자주 놓치는데, 포즈의 손목 추적은 몸 전체 맥락으로 잡아 훨씬 안정적이다.
//    또 손목은 주먹을 쥐어도 움직이지 않아 커서가 튀지 않는다.
//  - **주먹**: GestureRecognizer의 `Closed_Fist`. 손가락 기하를 직접 계산하는 것보다
//    학습된 분류기가 정확하다.
//
// 비용: 포즈 42ms + 제스처 87ms(빈 화면 최악값) → 매 프레임 둘 다 돌리면 8fps로 커서가
// 끊긴다. 그래서 **포즈는 매 프레임, 제스처는 GESTURE_EVERY 프레임마다** 돌린다.
// 커서는 부드럽게 움직이고, 주먹은 1초 유지를 판정할 만큼만 자주 확인하면 된다.
//
// 좌표 규약: 화면은 거울 모드라 화면상 위치는 x를 뒤집는다(screenX = 1 - x).

import { FilesetResolver, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision'
import { cameraReady, cameraVideo, openCamera } from './camera'

const RIGHT_WRIST = 16 // 참가자 기준 오른손 손목
const VIS_MIN = 0.5

/** 제스처를 몇 프레임마다 확인할지 (1이면 매 프레임) */
const GESTURE_EVERY = 2
/** 커서 떨림을 줄이는 지수 평활 계수 */
const SMOOTH = 0.35
/** 손목이 이 프레임 수만큼 안 보이면 커서를 숨긴다 */
const LOST_FRAMES = 8
/**
 * 손을 화면 끝까지 뻗기는 어렵다. 카메라 프레임의 가운데 영역만 화면 전체에 대응시킨다.
 * **부스 현장에서 카메라 위치·참가자 거리에 맞춰 조정할 값이다.**
 */
const ACTIVE = { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.85 }

export interface HandState {
  tracking: boolean
  x: number
  y: number
  fist: boolean
  progress: number
}

type Landmark = { x: number; y: number; z: number; visibility?: number }

class HandEngine {
  ready = false
  error: string | null = null
  delegate: 'GPU' | 'CPU' | null = null

  private pose: PoseLandmarker | null = null
  private gesture: GestureRecognizer | null = null
  private canvas: HTMLCanvasElement | null = null
  private raf = 0
  private running = false
  private lastTs = 0
  private poseTs = 0
  private gestureTs = 0
  private frame = 0
  private fps = 0
  private gestureName = ''

  private smoothX = 0.5
  private smoothY = 0.5
  private hasPoint = false
  private lost = LOST_FRAMES
  private fist = false
  private fistSince = 0
  /** 클릭 후 주먹을 펴기 전까지 재클릭을 막는다 */
  private consumed = false
  private holdMs = 1000
  private onDwell: ((x: number, y: number) => void) | null = null

  async start(holdMs: number, onDwell: (x: number, y: number) => void): Promise<boolean> {
    this.holdMs = holdMs
    this.onDwell = onDwell
    const video = await openCamera()
    if (!video) {
      this.error = 'camera'
      return false
    }
    if (!this.pose || !this.gesture) {
      try {
        const base = import.meta.env.BASE_URL
        const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
        const build = async (delegate: 'GPU' | 'CPU') => {
          const pose = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
          })
          const gesture = await GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${base}models/gesture_recognizer.task`, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
          })
          return { pose, gesture }
        }
        try {
          const m = await build('GPU')
          this.pose = m.pose
          this.gesture = m.gesture
          this.delegate = 'GPU'
        } catch {
          const m = await build('CPU')
          this.pose = m.pose
          this.gesture = m.gesture
          this.delegate = 'CPU'
        }

        const c = document.createElement('canvas')
        const scale = Math.min(1, 480 / (video.videoHeight || 720))
        c.width = Math.max(64, Math.round((video.videoWidth || 1280) * scale))
        c.height = Math.max(64, Math.round((video.videoHeight || 720) * scale))
        this.canvas = c
        // 첫 추론은 파이프라인이 차가워 수 초가 걸린다 → 미리 데운다
        const g = c.getContext('2d')
        if (g) {
          g.fillStyle = '#808080'
          g.fillRect(0, 0, c.width, c.height)
          try {
            this.poseTs = performance.now()
            this.pose.detectForVideo(c, this.poseTs)
            this.gestureTs = this.poseTs + 1
            this.gesture.recognizeForVideo(c, this.gestureTs)
          } catch {
            /* 워밍업 실패는 무시 */
          }
        }
        this.ready = true
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        return false
      }
    }
    this.reset()
    this.running = true
    this.loop()
    return true
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.reset()
  }

  private reset() {
    this.hasPoint = false
    this.lost = LOST_FRAMES
    this.fist = false
    this.fistSince = 0
    this.consumed = false
    this.gestureName = ''
  }

  private loop = () => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    if (now - this.lastTs < 33) return
    const dt = now - this.lastTs
    this.lastTs = now
    if (dt < 1000) this.fps = this.fps ? this.fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt

    const v = cameraVideo()
    if (!this.pose || !this.gesture || !this.canvas || !v || !cameraReady()) return
    const g = this.canvas.getContext('2d')
    if (!g) return
    g.drawImage(v, 0, 0, this.canvas.width, this.canvas.height)
    this.frame++

    // 위치: 매 프레임
    try {
      this.poseTs = Math.max(now, this.poseTs + 1)
      const r = this.pose.detectForVideo(this.canvas, this.poseTs)
      this.applyPose((r.landmarks?.[0] as Landmark[] | undefined) ?? null)
    } catch {
      /* 개별 프레임 실패는 다음 프레임에 회복된다 */
    }

    // 주먹: 몇 프레임마다 (커서 갱신률을 지키기 위해)
    if (this.frame % GESTURE_EVERY === 0) {
      try {
        this.gestureTs = Math.max(this.poseTs + 1, this.gestureTs + 1)
        const r = this.gesture.recognizeForVideo(this.canvas, this.gestureTs)
        this.applyGesture(r, now)
      } catch {
        /* 무시 */
      }
    }
  }

  private applyPose(lm: Landmark[] | null) {
    const w = lm?.[RIGHT_WRIST]
    if (!w || (w.visibility ?? 0) < VIS_MIN) {
      if (++this.lost >= LOST_FRAMES) this.hasPoint = false
      return
    }
    this.lost = 0

    // 거울 보정 후 활성 영역을 화면 전체로 확대 + 클램프
    const px = 1 - w.x
    const py = w.y
    const nx = Math.min(1, Math.max(0, (px - ACTIVE.x0) / (ACTIVE.x1 - ACTIVE.x0)))
    const ny = Math.min(1, Math.max(0, (py - ACTIVE.y0) / (ACTIVE.y1 - ACTIVE.y0)))

    if (!this.hasPoint) {
      this.smoothX = nx
      this.smoothY = ny
      this.hasPoint = true
    } else {
      this.smoothX += (nx - this.smoothX) * SMOOTH
      this.smoothY += (ny - this.smoothY) * SMOOTH
    }
  }

  private applyGesture(
    res: { gestures?: Array<Array<{ categoryName?: string; score?: number }>> },
    now: number,
  ) {
    const top = res.gestures?.[0]?.[0]
    this.gestureName = top?.categoryName ?? ''
    const fistNow = this.gestureName === 'Closed_Fist' && (top?.score ?? 0) >= 0.5

    if (fistNow && !this.fist) {
      this.fist = true
      this.fistSince = now
    } else if (!fistNow && this.fist) {
      this.fist = false
      this.fistSince = 0
      this.consumed = false // 펴면 다시 클릭할 수 있다
    }

    if (this.fist && !this.consumed && now - this.fistSince >= this.holdMs) {
      this.consumed = true
      this.onDwell?.(this.smoothX, this.smoothY)
    }
  }

  state(): HandState {
    const now = performance.now()
    return {
      tracking: this.hasPoint,
      x: this.smoothX,
      y: this.smoothY,
      fist: this.fist,
      progress:
        this.fist && !this.consumed
          ? Math.min(1, (now - this.fistSince) / this.holdMs)
          : this.fist
            ? 1
            : 0,
    }
  }

  /** 부스 점검용 (fps가 낮으면 ACTIVE 영역이나 GESTURE_EVERY를 조정한다) */
  status() {
    return {
      ready: this.ready,
      running: this.running,
      delegate: this.delegate,
      error: this.error,
      fps: Math.round(this.fps),
      gesture: this.gestureName,
      ...this.state(),
    }
  }
}

export const handEngine = new HandEngine()

// 개발 중 점검용 훅 (프로덕션 빌드에는 포함되지 않는다)
if (import.meta.env.DEV) {
  ;(window as unknown as { __hand?: unknown }).__hand = handEngine
}
