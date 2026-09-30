import type { PlayerId } from './types'

/** The mirrored screen's 1P is the camera's raw right half, just as in the flag game. */
export function playerFrame(width: number, height: number, player: PlayerId) {
  return { x: player === 1 ? width / 2 : 0, y: 0, width: width / 2, height }
}

export function drawPlayerFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, player: PlayerId, maxHeight: number) {
  const frame = playerFrame(video.videoWidth, video.videoHeight, player)
  if (frame.width <= 0 || frame.height <= 0) return false
  const scale = Math.min(1, maxHeight / frame.height)
  const width = Math.max(1, Math.round(frame.width * scale))
  const height = Math.max(1, Math.round(frame.height * scale))
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(video, frame.x, frame.y, frame.width, frame.height, 0, 0, width, height)
  return true
}
