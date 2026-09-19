import { BASE } from '../assets'
import type { Rabbit } from './gameC'

const asset = (name: string) => `${BASE}assets/game-c/${name}.png`
export const GAME_C_IMAGES = {
  playBackground: asset('play-background'), playOriginal: asset('play-background-original'),
  playBubble: asset('play-speech-bubble'),
  poundFeedback: asset('pound-feedback-sheet'),
  tutorial: asset('tutorial-background'), wood: asset('wood-plate'), bubble: asset('speech-bubble'),
  moon: asset('score-moon'), select: asset('rabbit-select-sheet'), cakes: asset('rice-cake-sheet'),
  handZone: asset('hand-zone'), backgrounds: [asset('result-under50'), asset('result-over50')],
  cards: [asset('report-p1-card'), asset('report-p2-card')], panels: [asset('report-p1-panel'), asset('report-p2-panel')],
  rating: [asset('rating-empty'), asset('rating-full')],
  dough: [1, 2, 3, 4].map(n => asset(`dough-${n}`)),
}
export type RabbitPose = 'up' | 'down' | 'idle' | 'squeeze-1' | 'squeeze-2'
export const rabbitSrc = (rabbit: Rabbit, pose: RabbitPose) => asset(`${rabbit}-${pose}`)
let loading: Promise<void> | null = null
export function preloadGameC() {
  if (loading) return loading
  const sources = [...Object.values(GAME_C_IMAGES).flat(), ...(['pink', 'brown'] as const).flatMap(r =>
    (['up', 'down', 'idle', 'squeeze-1', 'squeeze-2'] as const).map(p => rabbitSrc(r, p)))]
  loading = Promise.all(sources.map(src => new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(src))
    image.src = src
  }))).then(() => undefined).catch(error => { loading = null; throw error })
  return loading
}
