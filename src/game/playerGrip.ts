import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { cameraReady, cameraVideo } from './camera'
import { classifyPlayerHands, type HandGrip } from './handGrip'
import { drawPlayerFrame } from './playerFrame'
import type { PlayerId } from './types'

const SAMPLE_MS = 90
const STALE_MS = 350
const fresh = () => ({ grip: 'unknown' as HandGrip, hands: 0, at: 0, videoTime: -1, inferenceMs: 0 })

/** Independent two-hand trackers per player; both games reuse these models. */
class PlayerGripEngine {
  private models: [GestureRecognizer, GestureRecognizer] | null = null
  private loading: Promise<void> | null = null
  private canvases = [document.createElement('canvas'), document.createElement('canvas')]
  private frames = { 1: fresh(), 2: fresh() }
  private timestamps: Record<PlayerId, number> = { 1: 0, 2: 0 }
  private failures: Record<PlayerId, number> = { 1: 0, 2: 0 }
  error: string | null = null
  get ready() { return !!this.models }

  init() {
    if (this.models) return Promise.resolve()
    if (this.loading) return this.loading
    this.error = null
    this.loading = (async () => {
      const base = import.meta.env.BASE_URL
      const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
      const make = (delegate: 'GPU' | 'CPU') => GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/gesture_recognizer.task`, delegate },
        runningMode: 'VIDEO', numHands: 2,
      })
      const pair = async (delegate: 'GPU' | 'CPU'): Promise<[GestureRecognizer, GestureRecognizer]> => {
        const first = await make(delegate)
        try { return [first, await make(delegate)] } catch (error) { first.close(); throw error }
      }
      let models: [GestureRecognizer, GestureRecognizer]
      try { models = await pair('GPU') } catch { models = await pair('CPU') }
      // Pay the first inference cost while preparing, before a scored hand movement.
      for (const pid of [1, 2] as const) {
        const canvas = this.canvases[pid - 1], video = cameraVideo()
        const height = Math.min(720, video?.videoHeight || 720)
        canvas.height = height
        canvas.width = Math.round((video?.videoWidth || 1280) / 2 / (video?.videoHeight || 720) * height)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        const at = Math.max(performance.now(), this.timestamps[pid] + 1)
        this.timestamps[pid] = at
        try { models[pid - 1].recognizeForVideo(canvas, at) } catch { /* Retry on an actual camera frame. */ }
      }
      this.models = models
      this.reset()
    })().catch(error => { this.error = String(error) }).finally(() => { this.loading = null })
    return this.loading
  }

  reset() { this.frames = { 1: fresh(), 2: fresh() }; this.failures = { 1: 0, 2: 0 } }

  sample(player: PlayerId, now: number) {
    const state = this.frames[player], video = cameraVideo()
    const unknown = () => ({ grip: 'unknown' as HandGrip, hands: 0, at: now })
    if (!video || !cameraReady() || !this.models) return unknown()
    if (video.currentTime === state.videoTime || now - state.at < SAMPLE_MS)
      return now - state.at > STALE_MS ? unknown() : { grip: state.grip, hands: state.hands, at: state.at }
    if (!drawPlayerFrame(video, this.canvases[player - 1], player, 720)) return unknown()
    const canvas = this.canvases[player - 1]
    state.videoTime = video.currentTime
    state.at = now
    const at = Math.max(now, this.timestamps[player] + 1)
    this.timestamps[player] = at
    const started = performance.now()
    try {
      const result = this.models[player - 1].recognizeForVideo(canvas, at)
      state.hands = result.landmarks.length
      state.grip = classifyPlayerHands(result, canvas.width / canvas.height)
      this.failures[player] = 0
    } catch (error) {
      state.grip = 'unknown'; state.hands = 0
      if (++this.failures[player] >= 3) this.error = String(error)
    }
    state.inferenceMs = Math.round(performance.now() - started)
    return { grip: state.grip, hands: state.hands, at: state.at }
  }

  status() {
    const player = (pid: PlayerId) => {
      const state = this.frames[pid], stale = performance.now() - state.at > STALE_MS
      const canvas = this.canvases[pid - 1]
      return { grip: stale ? 'unknown' as HandGrip : state.grip, hands: stale ? 0 : state.hands,
        at: state.at, inferenceMs: state.inferenceMs, resolution: [canvas.width, canvas.height] }
    }
    return { ready: this.ready, error: this.error, players: { 1: player(1), 2: player(2) } }
  }
}

export const playerGripEngine = new PlayerGripEngine()
