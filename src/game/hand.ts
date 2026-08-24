// 주먹 제스처 판정 전용 엔진.
//
// 역할 분담:
//  - **위치**는 `poseEngine.pointer()` 가 담당한다. 인게임에서는 2인 판정으로 이미
//    포즈를 돌리고 있으므로, 1P의 오른손 손목을 재사용해 **추가 추론 비용이 없다.**
//  - **주먹**만 이 엔진이 GestureRecognizer로 판정한다.
//
// 비용: 제스처는 회당 87ms(빈 화면 최악값)로 포즈(42ms)보다 2배 느리다.
// 매 프레임 돌리면 커서가 끊기므로 GESTURE_EVERY 프레임마다 확인한다.
// 커서 위치는 포즈가 매 프레임 갱신하니 부드럽고, 주먹은 1초 유지를 판정할 만큼만
// 자주 보면 된다.

import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { cameraReady, cameraVideo, openCamera } from './camera'
import { poseEngine } from './pose'

/** 제스처를 몇 프레임마다 확인할지 (fps가 낮으면 3~4로 올린다) */
const GESTURE_EVERY = 2
/** 이 점수 미만의 주먹 판정은 무시한다 (오탐 방지) */
const FIST_SCORE_MIN = 0.5

export interface HandState {
  tracking: boolean
  x: number
  y: number
  fist: boolean
  progress: number
}

class HandEngine {
  ready = false
  error: string | null = null
  delegate: 'GPU' | 'CPU' | null = null

  private gesture: GestureRecognizer | null = null
  private canvas: HTMLCanvasElement | null = null
  private raf = 0
  private running = false
  private lastTs = 0
  private gestureTs = 0
  private frame = 0
  private fps = 0
  private gestureName = ''

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
    if (!this.gesture) {
      try {
        const base = import.meta.env.BASE_URL
        const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
        const make = (delegate: 'GPU' | 'CPU') =>
          GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${base}models/gesture_recognizer.task`, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
          })
        try {
          this.gesture = await make('GPU')
          this.delegate = 'GPU'
        } catch {
          this.gesture = await make('CPU')
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
            this.gestureTs = performance.now()
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
    if (!this.gesture || !this.canvas || !v || !cameraReady()) return
    if (++this.frame % GESTURE_EVERY !== 0) return

    const g = this.canvas.getContext('2d')
    if (!g) return
    g.drawImage(v, 0, 0, this.canvas.width, this.canvas.height)
    try {
      this.gestureTs = Math.max(now, this.gestureTs + 1)
      const r = this.gesture.recognizeForVideo(this.canvas, this.gestureTs)
      this.applyGesture(r, now)
    } catch {
      /* 개별 프레임 실패는 다음 프레임에 회복된다 */
    }
  }

  private applyGesture(
    res: { gestures?: Array<Array<{ categoryName?: string; score?: number }>> },
    now: number,
  ) {
    const top = res.gestures?.[0]?.[0]
    this.gestureName = top?.categoryName ?? ''
    const fistNow = this.gestureName === 'Closed_Fist' && (top?.score ?? 0) >= FIST_SCORE_MIN

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
      const p = poseEngine.pointer()
      this.onDwell?.(p.x, p.y)
    }
  }

  /**
   * 위치는 poseEngine, 주먹은 이 엔진 — 합쳐서 커서 상태로 돌려준다.
   * 엔진이 꺼져 있으면(본게임 등) tracking=false라 커서가 그려지지 않는다.
   * 누를 수 없는 커서가 떠다니면 혼란스럽고 게임 중 시선을 뺏기 때문이다.
   */
  state(): HandState {
    const now = performance.now()
    const p = poseEngine.pointer()
    return {
      tracking: this.running && p.visible,
      x: p.x,
      y: p.y,
      fist: this.fist,
      progress:
        this.fist && !this.consumed
          ? Math.min(1, (now - this.fistSince) / this.holdMs)
          : this.fist
            ? 1
            : 0,
    }
  }

  status() {
    return {
      ready: this.ready,
      running: this.running,
      delegate: this.delegate,
      error: this.error,
      gestureFps: Math.round(this.fps),
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
