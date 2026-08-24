// MediaPipe PoseLandmarker 래퍼.
// 2인 인식은 numPoses:2 대신 프레임 좌/우 분할 + 각 영역 단일 포즈 추정(스펙 §4.1).
// 플레이어 귀속이 물리적으로 보장되고 ID 스왑이 원천 차단된다.
// 화면은 거울 모드이므로: 화면 왼쪽(1P)에 선 사람 = 원본 프레임의 오른쪽 절반.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PlayerId, PlayerPose, Hand } from './types'

const NOSE = 0
const L_SHOULDER = 11
const R_SHOULDER = 12
const L_WRIST = 15
const R_WRIST = 16

interface Calib {
  shoulderY: number
  maxWristY: { left: number; right: number } // y는 위로 갈수록 작다 → max height = min y
  thresholdY: { left: number; right: number }
  done: boolean
}

function emptyPose(): PlayerPose {
  return {
    present: false,
    noseX: null,
    noseY: null,
    leftRaised: false,
    rightRaised: false,
    leftWristY: null,
    rightWristY: null,
    shoulderY: null,
  }
}

class PoseEngine {
  stream: MediaStream | null = null
  cameraOk = false
  keyboardMode = false
  ready = false
  initError: string | null = null

  private video: HTMLVideoElement | null = null
  private landmarkers: [PoseLandmarker, PoseLandmarker] | null = null
  private halves: [HTMLCanvasElement, HTMLCanvasElement] | null = null
  private raf = 0
  private lastTs = 0
  private pose: Record<PlayerId, PlayerPose> = { 1: emptyPose(), 2: emptyPose() }
  private calib: Record<PlayerId, Calib> = { 1: this.freshCalib(), 2: this.freshCalib() }
  private calibrating = false
  private keys: Record<PlayerId, { left: boolean; right: boolean }> = {
    1: { left: false, right: false },
    2: { left: false, right: false },
  }

  private freshCalib(): Calib {
    return {
      shoulderY: 0.5,
      maxWristY: { left: 1, right: 1 },
      thresholdY: { left: 0.35, right: 0.35 },
      done: false,
    }
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
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      })
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = this.stream
      await video.play()
      this.video = video

      const base = import.meta.env.BASE_URL
      const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
      const make = () =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${base}models/pose_landmarker_lite.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
      this.landmarkers = [await make(), await make()]

      const mk = () => {
        const c = document.createElement('canvas')
        c.width = 640
        c.height = 720
        return c
      }
      this.halves = [mk(), mk()]
      this.cameraOk = true
      this.ready = true
      this.loop()
      // rAF는 창이 가려지면 정지 → 인터벌로 이어받는다
      window.setInterval(() => {
        if (performance.now() - this.lastTs > 200) this.detectOnce()
      }, 100)
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err)
      this.keyboardMode = true
      this.ready = true // 키보드 모드로 진행 가능
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
    this.lastTs = now

    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return

    // 1P(화면 왼쪽) = 원본 오른쪽 절반, 2P = 원본 왼쪽 절반
    const srcXFor: Record<PlayerId, number> = { 1: vw / 2, 2: 0 }
    for (const pid of [1, 2] as PlayerId[]) {
      const canvas = this.halves[pid - 1]
      const g = canvas.getContext('2d')!
      g.drawImage(v, srcXFor[pid], 0, vw / 2, vh, 0, 0, canvas.width, canvas.height)
      try {
        const res = this.landmarkers[pid - 1].detectForVideo(canvas, now + (pid - 1) * 0.1)
        this.applyResult(pid, res.landmarks?.[0] ?? null)
      } catch {
        /* 개별 프레임 추론 실패는 무시 */
      }
    }
  }

  private applyResult(pid: PlayerId, lm: Array<{ x: number; y: number; visibility?: number }> | null) {
    const p = this.pose[pid]
    if (!lm) {
      p.present = false
      p.leftRaised = this.keys[pid].left
      p.rightRaised = this.keys[pid].right
      return
    }
    const nose = lm[NOSE]
    const ls = lm[L_SHOULDER]
    const rs = lm[R_SHOULDER]
    const lw = lm[L_WRIST]
    const rw = lm[R_WRIST]
    const shoulderY = (ls.y + rs.y) / 2

    p.present = true
    p.noseX = nose.x
    p.noseY = nose.y
    p.shoulderY = shoulderY
    p.leftWristY = lw.y
    p.rightWristY = rw.y

    const c = this.calib[pid]
    if (this.calibrating) {
      // 양손을 최대한 들었을 때의 손목 y(최소값) 기록
      c.maxWristY.left = Math.min(c.maxWristY.left, lw.y)
      c.maxWristY.right = Math.min(c.maxWristY.right, rw.y)
      c.shoulderY = shoulderY
    }

    const th = (hand: Hand) =>
      c.done ? c.thresholdY[hand] : shoulderY - 0.12 // 캘리브레이션 전 임시 기준: 어깨보다 확실히 위

    p.leftRaised = this.keys[pid].left || lw.y < th('left')
    p.rightRaised = this.keys[pid].right || rw.y < th('right')
  }

  getPose(pid: PlayerId): PlayerPose {
    // 키보드 입력은 항상 반영 (카메라 유무와 무관한 진행요원용 예비 입력)
    const p = { ...this.pose[pid] }
    p.leftRaised = p.leftRaised || this.keys[pid].left
    p.rightRaised = p.rightRaised || this.keys[pid].right
    if (this.keys[pid].left || this.keys[pid].right) p.present = true
    return p
  }

  /** 캘리브레이션: 측정 시작 */
  startCalibration() {
    this.calib = { 1: this.freshCalib(), 2: this.freshCalib() }
    this.calibrating = true
  }

  /** 캘리브레이션 종료: 개인 최대 손목 높이의 75% 지점을 임계선으로 확정 (스펙 §4.1) */
  finishCalibration() {
    this.calibrating = false
    for (const pid of [1, 2] as PlayerId[]) {
      const c = this.calib[pid]
      for (const hand of ['left', 'right'] as Hand[]) {
        const reach = c.shoulderY - c.maxWristY[hand] // 어깨→최대높이 거리
        c.thresholdY[hand] =
          reach > 0.05 ? c.shoulderY - reach * 0.75 : c.shoulderY - 0.12
      }
      c.done = true
    }
  }

  /** 캘리브레이션 중 양손이 어깨 위인지 (진행 게이지용) */
  bothHandsUpRaw(pid: PlayerId): boolean {
    const p = this.pose[pid]
    if (this.keys[pid].left && this.keys[pid].right) return true
    if (!p.present || p.leftWristY == null || p.rightWristY == null || p.shoulderY == null) return false
    return p.leftWristY < p.shoulderY - 0.05 && p.rightWristY < p.shoulderY - 0.05
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach(t => t.stop())
    this.landmarkers?.forEach(l => l.close())
    this.stream = null
    this.ready = false
  }
}

export const poseEngine = new PoseEngine()
