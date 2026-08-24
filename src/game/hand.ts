// MediaPipe HandLandmarker 래퍼 — 손으로 화면을 조작하기 위한 것.
//
// PoseLandmarker(몸 33점)로는 주먹을 판별할 수 없다. 손가락 정보가 없기 때문이다.
// 그래서 메뉴 조작에는 손 랜드마크 21점을 쓴다. 게임 중에는 몸 인식만 돌리므로
// 두 모델이 동시에 추론하는 일은 없다(프레임 비용이 겹치지 않는다).
//
// 좌표 규약: 화면은 거울 모드라 화면상 위치는 x를 뒤집어야 한다(screenX = 1 - x).

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { cameraReady, cameraVideo, openCamera } from './camera'

// 손 랜드마크 인덱스
const WRIST = 0
const INDEX_MCP = 5
const MIDDLE_MCP = 9
const TIPS = [8, 12, 16, 20] // 검지·중지·약지·소지 끝
const PIPS = [6, 10, 14, 18] // 각 손가락 둘째 관절

/** 주먹으로 볼 최소 접힌 손가락 수 */
const FIST_FINGERS = 3
/** 커서 떨림을 줄이는 지수 평활 계수 (작을수록 부드럽고 느리다) */
const SMOOTH = 0.35
/** 손이 이 프레임 수만큼 안 보이면 커서를 숨긴다 */
const LOST_FRAMES = 8
/**
 * 손은 화면 끝까지 편하게 뻗기 어렵다. 카메라 프레임의 가운데 영역만
 * 화면 전체에 대응시켜 적은 움직임으로 전체를 덮게 한다.
 */
const ACTIVE = { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.85 }

export interface HandState {
  /** 손이 추적되고 있는지 */
  tracking: boolean
  /** 화면 정규화 좌표 (0~1, 거울 보정됨) */
  x: number
  y: number
  /** 주먹을 쥐고 있는지 */
  fist: boolean
  /** 주먹 유지 시간 대비 진행률 (0~1) */
  progress: number
}

type Landmark = { x: number; y: number; z: number }

class HandEngine {
  ready = false
  error: string | null = null
  delegate: 'GPU' | 'CPU' | null = null

  private lm: HandLandmarker | null = null
  private canvas: HTMLCanvasElement | null = null
  private raf = 0
  private running = false
  private lastTs = 0
  private lastDetect = 0
  private fps = 0

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
    if (!this.lm) {
      try {
        const base = import.meta.env.BASE_URL
        const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
        const make = (delegate: 'GPU' | 'CPU') =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
            runningMode: 'VIDEO',
            numHands: 2, // 오른손을 골라내려면 두 손을 다 봐야 한다
          })
        try {
          this.lm = await make('GPU')
          this.delegate = 'GPU'
        } catch {
          this.lm = await make('CPU')
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
            this.lastDetect = performance.now()
            this.lm.detectForVideo(c, this.lastDetect)
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
    if (!this.lm || !this.canvas || !v || !cameraReady()) return
    const g = this.canvas.getContext('2d')
    if (!g) return
    g.drawImage(v, 0, 0, this.canvas.width, this.canvas.height)
    const ts = Math.max(now, this.lastDetect + 1)
    this.lastDetect = ts
    try {
      const res = this.lm.detectForVideo(this.canvas, ts)
      this.apply(res, now)
    } catch {
      /* 개별 프레임 실패는 다음 프레임에 회복된다 */
    }
  }

  private apply(
    res: { landmarks?: Landmark[][]; handedness?: Array<Array<{ categoryName?: string }>> },
    now: number,
  ) {
    const hands = res.landmarks ?? []
    if (hands.length === 0) {
      if (++this.lost >= LOST_FRAMES) {
        this.hasPoint = false
        this.fist = false
        this.fistSince = 0
        this.consumed = false
      }
      return
    }
    this.lost = 0

    // 오른손을 고른다. 거울 모드에서는 MediaPipe가 붙이는 라벨이 뒤집혀 보이므로
    // 라벨을 그대로 믿지 않고, 손이 하나면 그 손을 쓴다(메뉴가 멈추지 않게).
    let idx = 0
    if (hands.length > 1) {
      const labels = res.handedness ?? []
      const right = labels.findIndex(h => h[0]?.categoryName === 'Right')
      if (right >= 0) idx = right
      else {
        // 라벨을 못 얻으면 화면상 더 왼쪽(= 1P 자리)에 있는 손을 쓴다
        idx = hands.reduce(
          (best, h, i) => (1 - h[MIDDLE_MCP].x < 1 - hands[best][MIDDLE_MCP].x ? i : best),
          0,
        )
      }
    }
    const lm = hands[idx]

    // 기준점은 손바닥 중심(중지 MCP). 손끝을 쓰면 주먹을 쥘 때 커서가 튄다.
    const px = 1 - lm[MIDDLE_MCP].x // 거울 보정
    const py = lm[MIDDLE_MCP].y

    // 활성 영역을 화면 전체로 확대 + 클램프
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

    // 주먹 판별: 손가락 끝이 손목에 PIP보다 가까우면 접힌 것.
    // 손 크기(손목~중지 MCP)로 정규화해 거리와 무관하게 동작한다.
    const wrist = lm[WRIST]
    const palm = Math.hypot(lm[MIDDLE_MCP].x - wrist.x, lm[MIDDLE_MCP].y - wrist.y) || 0.001
    let curled = 0
    for (let i = 0; i < TIPS.length; i++) {
      const tip = lm[TIPS[i]]
      const pip = lm[PIPS[i]]
      const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y) / palm
      const dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y) / palm
      if (dTip < dPip) curled++
    }
    const fistNow = curled >= FIST_FINGERS

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

  status() {
    return {
      ready: this.ready,
      running: this.running,
      delegate: this.delegate,
      error: this.error,
      fps: Math.round(this.fps),
      ...this.state(),
    }
  }
}

export const handEngine = new HandEngine()

// 개발 중 점검용 훅 (프로덕션 빌드에는 포함되지 않는다)
if (import.meta.env.DEV) {
  ;(window as unknown as { __hand?: unknown }).__hand = handEngine
}
