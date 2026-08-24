// 피그마 디자인 파일에서 추출한 에셋 매니페스트.
// 아바타/표정/이펙트는 스프라이트 시트로 전달되어, 피그마 노드의 크롭값(%)을 그대로 사용한다.

export const BASE = import.meta.env.BASE_URL

export const IMG = {
  sheetBlue: `${BASE}assets/sheet_blue.png`,
  sheetWhite: `${BASE}assets/sheet_white.png`,
  sheetMaWhiteStand: `${BASE}assets/sheet_ma_white_stand.png`,
  sheetFaWhiteStand: `${BASE}assets/sheet_fa_white_stand.png`,
  sheetFaces: `${BASE}assets/sheet_faces.png`,
  sheetEffects: `${BASE}assets/sheet_effects.png`,
  effectMiss: `${BASE}assets/effect_miss.png`,
  sheetTutChars: `${BASE}assets/sheet_tut_chars.png`,
  count1: `${BASE}assets/count1.png`,
  count2: `${BASE}assets/count2.png`,
  count3: `${BASE}assets/count3.png`,
  countStart: `${BASE}assets/count_start.png`,
  end: `${BASE}assets/end.png`,
  mapBg: `${BASE}assets/map_bg.png`,
  placeCafe: `${BASE}assets/place_cafe.png`,
  sheetPlaces: `${BASE}assets/sheet_places.png`,
  tutBg: `${BASE}assets/tut_bg.png`,
  gameBg: `${BASE}assets/game_bg.png`,
  faceZone: `${BASE}assets/face_zone.png`,
  title: `${BASE}assets/title.png`,
}

// 시트 크롭 정의: 박스 대비 이미지 크기/오프셋(%) — 피그마 생성 코드의 값 그대로
export interface Crop {
  src: string
  w: number // width %
  h: number // height %
  l: number // left %
  t: number // top %
}

export type Gender = 'ma' | 'fa' // 할아버지(ma=male) / 할머니(fa=female)? → 피그마 네이밍: ma=할머니(grandma), fa=할아버지(grandfa)
export type FlagColor = 'blue' | 'white'
export type PoseName = 'stand' | 'up' | 'left' | 'right'
export type FaceName = 'stand' | 'good' | 'angry_left' | 'angry_right' | 'sad'

// 주의: 피그마 시안 기준 ma_* 스프라이트 = 할머니 그림, fa_* = 할아버지 그림
export const BODY: Record<Gender, Record<FlagColor, Record<PoseName, Crop>>> = {
  ma: {
    blue: {
      stand: { src: IMG.sheetBlue, w: 409.9, h: 273.1, l: -4.05, t: -23.27 },
      up: { src: IMG.sheetBlue, w: 412.48, h: 275.15, l: -101.43, t: -24.2 },
      left: { src: IMG.sheetBlue, w: 412.48, h: 275.15, l: -206.2, t: -24.2 },
      right: { src: IMG.sheetBlue, w: 412.48, h: 275.15, l: -298.44, t: -24.2 },
    },
    white: {
      stand: { src: IMG.sheetMaWhiteStand, w: 405.47, h: 267.96, l: -2.63, t: -21.49 },
      up: { src: IMG.sheetWhite, w: 407, h: 267.96, l: -98.97, t: -21.49 },
      left: { src: IMG.sheetWhite, w: 407, h: 267.96, l: -203.54, t: -21.49 },
      right: { src: IMG.sheetWhite, w: 407, h: 267.96, l: -294.11, t: -21.49 },
    },
  },
  fa: {
    blue: {
      stand: { src: IMG.sheetBlue, w: 414.05, h: 273.1, l: -4.9, t: -148.39 },
      up: { src: IMG.sheetBlue, w: 410.41, h: 273.1, l: -99.83, t: -148.39 },
      left: { src: IMG.sheetBlue, w: 410.41, h: 273.1, l: -205.17, t: -148.39 },
      right: { src: IMG.sheetBlue, w: 410.41, h: 273.1, l: -299.02, t: -148.39 },
    },
    white: {
      stand: { src: IMG.sheetFaWhiteStand, w: 396.09, h: 267.96, l: -0.06, t: -143.17 },
      up: { src: IMG.sheetWhite, w: 405.47, h: 267.96, l: -97.75, t: -143.17 },
      left: { src: IMG.sheetWhite, w: 405.47, h: 267.96, l: -202.75, t: -143.17 },
      right: { src: IMG.sheetWhite, w: 405.47, h: 267.96, l: -294.25, t: -143.17 },
    },
  },
}

export const FACE: Record<FaceName, Crop> = {
  stand: { src: IMG.sheetFaces, w: 757.89, h: 359.1, l: -34.95, t: -143.06 },
  good: { src: IMG.sheetFaces, w: 757.89, h: 359.1, l: -181.96, t: -143.06 },
  angry_left: { src: IMG.sheetFaces, w: 757.89, h: 359.1, l: -329.07, t: -143.06 },
  angry_right: { src: IMG.sheetFaces, w: 757.89, h: 359.1, l: -479.32, t: -143.06 },
  sad: { src: IMG.sheetFaces, w: 757.89, h: 359.1, l: -624.75, t: -143.06 },
}

// 아바타 정사각 박스 기준 표정 레이어 배치 (피그마 800px 박스 실측)
export const FACE_LAYOUT = { left: 31.5, top: 15, size: 37 }

export const EFFECT = {
  good: { crop: { src: IMG.sheetEffects, w: 332.18, h: 337.5, l: -132.7, t: -219.69 }, aspect: 627 / 347 },
  great: { crop: { src: IMG.sheetEffects, w: 329.33, h: 398.52, l: -11.32, t: -194.46 }, aspect: 849 / 395 },
  ok: { crop: { src: IMG.sheetEffects, w: 564.71, h: 524.27, l: -430.29, t: -267.48 }, aspect: 266 / 161 },
  buttonStart: { crop: { src: IMG.sheetEffects, w: 246.79, h: 402.99, l: -11.05, t: -60.07 }, aspect: 778 / 268 },
}

export const TUT_CHAR: Record<'grandma' | 'grandfa', Crop> = {
  grandma: { src: IMG.sheetTutChars, w: 266.37, h: 119.47, l: -23.41, t: -11.67 },
  grandfa: { src: IMG.sheetTutChars, w: 266.37, h: 119.47, l: -142.72, t: -11.67 },
}

export interface Place {
  key: string
  label: string
  x: number
  y: number
  w: number
  h: number
  crop: Crop
  active: boolean
}

export const PLACES: Place[] = [
  { key: 'school', label: '초등학교 — 오락가락 청기백기', x: 1400, y: 675, w: 487, h: 388, active: true,
    crop: { src: IMG.sheetPlaces, w: 327.97, h: 231.58, l: -222, t: -124.89 } },
  { key: 'cafe', label: '카페 (준비중)', x: 1212, y: 248, w: 220, h: 237, active: false,
    crop: { src: IMG.placeCafe, w: 99.53, h: 99.78, l: 0.3, t: 0.23 } },
  { key: 'mountain', label: '전망대 (준비중)', x: 186, y: 106, w: 351, h: 188, active: false,
    crop: { src: IMG.sheetPlaces, w: 416.13, h: 438.89, l: 0, t: -0.09 } },
  { key: 'hospital', label: '병원 (준비중)', x: 868, y: 660, w: 454, h: 326, active: false,
    crop: { src: IMG.sheetPlaces, w: 426.21, h: 333.88, l: -168.38, t: -210.37 } },
  { key: 'mart', label: '마트 (준비중)', x: 1458, y: 211, w: 445, h: 348, active: false,
    crop: { src: IMG.sheetPlaces, w: 382.41, h: 275.55, l: -272.3, t: -11.06 } },
  { key: 'pharmacy', label: '약국 (준비중)', x: 597, y: 759, w: 297, h: 267, active: false,
    crop: { src: IMG.sheetPlaces, w: 586.36, h: 366.48, l: -86.39, t: -234.83 } },
  { key: 'bank', label: '은행 (준비중)', x: 904, y: 237, w: 289, h: 311, active: false,
    crop: { src: IMG.sheetPlaces, w: 602.8, h: 315.49, l: -182.16, t: -24.86 } },
  { key: 'health', label: '보건소 (준비중)', x: 328, y: 329, w: 401, h: 297, active: false,
    crop: { src: IMG.sheetPlaces, w: 416.13, h: 315.49, l: -10.3, t: -73.46 } },
]
