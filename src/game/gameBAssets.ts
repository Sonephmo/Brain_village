import { BASE } from '../assets'

const asset = (name: string) => `${BASE}assets/game-b/${name}.png`
const sequence = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => asset(`fire_${name}_${String(i + 1).padStart(2, '0')}`))

export const GAME_B_IMAGES = {
  background: asset('background'),
  tutorial: asset('tutorial-background'),
  result: asset('result-background'),
  wood: asset('firewood'),
  heart: asset('heart'),
  family: ['dog', 'cat', 'boy', 'girl'].map(name => asset(`family-${name}`)),
}
export const FIRE_FRAMES = {
  start: sequence('start', 4),
  stand: sequence('stand', 4),
  left: sequence('left', 4),
  // Figma 201:97: 같은 원본을 수평 반전. 이미지 파일 자체는 원본 그대로 보관한다.
  right: sequence('right', 4),
  big: sequence('big', 7),
}
export type FireKind = keyof typeof FIRE_FRAMES

export const GAME_B_REPORT = {
  background: asset('report-background'),
  cards: [asset('report-p1-card'), asset('report-p2-card')],
  panels: [asset('report-p1-panel'), asset('report-p2-panel')],
  emptyFlame: asset('report-flame-empty'),
}
export const GAME_B_CHARACTERS = {
  grandma: { up: asset('girl_up'), down: asset('girl_down'), stand: asset('girl_stand'), tutorial: asset('girl_tutorial') },
  grandfa: { up: asset('boy_up'), down: asset('boy_down'), stand: asset('boy_stand'), tutorial: asset('boy_tutorial') },
}

/** 01–04 are the colour transition; 05–07 are the cropped blue idle cycle. */
export function fireFrameIndex(kind: FireKind, tick: number): number {
  if (kind === 'big') return tick < 4 ? tick : 4 + (tick - 4) % 3
  if (kind === 'start') return Math.min(tick, 3)
  return tick % FIRE_FRAMES[kind].length
}

let loading: Promise<void> | null = null
export function preloadGameB(): Promise<void> {
  if (loading) return loading
  const sources = [
    ...Object.values(GAME_B_IMAGES).flat(),
    ...Object.values(FIRE_FRAMES).flat(),
    ...Object.values(GAME_B_REPORT).flat(),
    ...Object.values(GAME_B_CHARACTERS).flatMap(character => Object.values(character)),
  ]
  loading = Promise.all(sources.map(src => new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${src}`))
    img.src = src
  }))).then(() => undefined).catch(error => { loading = null; throw error })
  return loading
}
