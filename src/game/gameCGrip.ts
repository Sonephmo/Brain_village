import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { cameraReady, cameraVideo } from './camera'
import type { Grip } from './gameC'
import type { PlayerId } from './types'

/** Only the active kneading player's half-frame is analyzed; never generates clicks. */
class RiceGripEngine {
  private model: GestureRecognizer | null = null
  private loading: Promise<void> | null = null
  private canvas = document.createElement('canvas')
  private at = 0
  private videoTime = -1
  private player: PlayerId | null = null
  private grip: Grip = 'unknown'
  error: string | null = null

  init() {
    if (this.loading) return this.loading
    this.loading = (async () => {
      const base = import.meta.env.BASE_URL
      const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
      const make = (delegate: 'GPU' | 'CPU') => GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/gesture_recognizer.task`, delegate },
        runningMode: 'VIDEO', numHands: 2,
      })
      try { this.model = await make('GPU') } catch { this.model = await make('CPU') }
    })().catch(error => { this.error = String(error) })
    return this.loading
  }
  reset() { this.player = null; this.grip = 'unknown'; this.videoTime = -1 }
  sample(player: PlayerId, now: number): Grip {
    if (this.player !== player) { this.reset(); this.player = player }
    const video = cameraVideo()
    if (!video || !cameraReady() || !this.model) return 'unknown'
    if (now - this.at < 90) return this.grip
    if (video.currentTime === this.videoTime) return now - this.at > 350 ? 'unknown' : this.grip
    this.videoTime = video.currentTime
    this.at = Math.max(now, this.at + 1)
    const w = video.videoWidth / 2
    this.canvas.height = 360
    this.canvas.width = Math.round(w / video.videoHeight * 360)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return 'unknown'
    ctx.drawImage(video, player === 1 ? w : 0, 0, w, video.videoHeight, 0, 0, this.canvas.width, this.canvas.height)
    try {
      const result = this.model.recognizeForVideo(this.canvas, this.at)
      const hands = result.gestures.map(g => g[0]).filter(g => g && g.score >= 0.55)
      this.grip = hands.length === 2 && hands.every(g => g.categoryName === 'Closed_Fist') ? 'closed'
        : hands.length === 2 && hands.every(g => g.categoryName === 'Open_Palm') ? 'open' : 'unknown'
    } catch { this.grip = 'unknown' }
    return this.grip
  }
}
export const riceGripEngine = new RiceGripEngine()
