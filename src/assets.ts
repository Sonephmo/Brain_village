// 에셋 매니페스트.
// 피그마가 내보낸 크롭 퍼센트는 노드마다 손으로 맞춰져 있어 프레임 간격이 불균일했고
// (예: blue 시트에서 362/390/343px), 그 결과 옆 프레임의 깃발이 물려 들어왔다.
// 그래서 시트를 캔버스로 실측해 얻은 **자연 픽셀 좌표**를 진실의 원천으로 삼는다.
//   - 아바타 본체 시트 1536x1024 = 4열 x 2행, 셀 384x512 (열: stand/up/left/right, 행: ma/fa)
//   - 표정 시트 2880x1440 = 5열, 셀 576 폭. 표정 5종은 동일한 서브 사각형을 써서 상호 정렬을 보존한다.

export const BASE = import.meta.env.BASE_URL
const A = (n: string) => `${BASE}assets/${n}`

/** 시트에서 잘라낼 자연 픽셀 사각형. 컨테이너 크기와 무관하게 CSS %로 렌더된다. */
export interface Frame {
  src: string
  sheet: [number, number]
  rect: [number, number, number, number] // x, y, w, h
}

export const IMG = {
  effectMiss: A('effect_miss.png'),
  count1: A('count1.png'),
  count2: A('count2.png'),
  count3: A('count3.png'),
  countStart: A('count_start.png'),
  end: A('end.png'),
  mapBg: A('map_bg.png'),
  placeCafe: A('place_cafe.png'),
  tutBg: A('tut_bg.png'),
  gameBg: A('game_bg.png'),
  faceZone: A('face_zone.png'),
  titleMain: A('title_main.jpg'),
  titleLogo: A('title_logo.png'),
}

const SHEET_BLUE: [number, number] = [1536, 1024]
const SHEET_WHITE: [number, number] = [1536, 1024]
const SHEET_FACES: [number, number] = [2880, 1440]
const SHEET_FX: [number, number] = [1920, 1080]
const SHEET_TUT: [number, number] = [2400, 1792]

// ─── 아바타 본체 ───

/** 참가자가 고르는 캐릭터. 시트 행 0 = 할머니, 행 1 = 할아버지 */
export type Avatar = 'grandma' | 'grandfa'
export type FlagColor = 'blue' | 'white'
export type PoseName = 'stand' | 'up' | 'left' | 'right'

const CELL_W = 384
const CELL_H = 512
const POSE_COL: Record<PoseName, number> = { stand: 0, up: 1, left: 2, right: 3 }
const AVATAR_ROW: Record<Avatar, number> = { grandma: 0, grandfa: 1 }
const FLAG_SHEET: Record<FlagColor, { src: string; sheet: [number, number] }> = {
  blue: { src: A('sheet_blue.png'), sheet: SHEET_BLUE },
  white: { src: A('sheet_white.png'), sheet: SHEET_WHITE },
}

export function bodyFrame(avatar: Avatar, flag: FlagColor, pose: PoseName): Frame {
  const s = FLAG_SHEET[flag]
  return {
    src: s.src,
    sheet: s.sheet,
    rect: [POSE_COL[pose] * CELL_W, AVATAR_ROW[avatar] * CELL_H, CELL_W, CELL_H],
  }
}

/** 본체 셀의 가로:세로 = 384:512. 아바타 박스는 이 비율을 지켜야 인물이 찌그러지지 않는다. */
export const BODY_ASPECT = CELL_W / CELL_H // 0.75

// ─── 표정 ───

export type FaceName = 'stand' | 'good' | 'angry_left' | 'angry_right' | 'sad'
const FACE_COL: Record<FaceName, number> = { stand: 0, good: 1, angry_left: 2, angry_right: 3, sad: 4 }
// 5종 실측 바운딩박스의 합집합(x 122~469, y 685~939)을 감싸는 공통 사각형.
// 5종 모두 같은 사각형을 써야 눈·입 위치가 서로 어긋나지 않는다.
const FACE_RECT = { x: 110, y: 670, w: 372, h: 280 }
export const FACE_ASPECT = FACE_RECT.w / FACE_RECT.h

export function faceFrame(face: FaceName): Frame {
  return {
    src: A('sheet_faces.png'),
    sheet: SHEET_FACES,
    rect: [FACE_COL[face] * 576 + FACE_RECT.x, FACE_RECT.y, FACE_RECT.w, FACE_RECT.h],
  }
}

export interface FaceAnchor {
  left: number // 셀 폭 대비 %
  top: number // 셀 높이 대비 %
  width: number // 셀 폭 대비 %
}

// 본체 셀 대비 표정 레이어 배치.
// 스펙 §5.3은 4개 포즈의 얼굴 앵커를 동일하게 유지하라고 요구했지만, 실제 아트는
// 포즈마다 머리가 좌우로 최대 61px(셀 폭의 16%) 이동한다. 얼굴 오벌(피부 연결성분)을
// 시트에서 실측해 포즈별 앵커를 따로 잡는다 — 스펙이 명시한 대비책.
// 아트가 앵커 고정으로 수정되면 이 표는 캐릭터별 1개 값으로 줄일 수 있다.
export const FACE_ANCHOR: Record<Avatar, Record<PoseName, FaceAnchor>> = {
  grandma: {
    stand: { left: 32.74, top: 33.71, width: 35.79 },
    up: { left: 25.6, top: 33.37, width: 36.45 },
    left: { left: 26.23, top: 34.0, width: 35.79 },
    right: { left: 16.85, top: 34.0, width: 35.79 },
  },
  grandfa: {
    stand: { left: 31.57, top: 22.66, width: 38.09 },
    up: { left: 24.8, top: 22.66, width: 38.09 },
    left: { left: 25.58, top: 22.76, width: 38.09 },
    right: { left: 16.52, top: 22.73, width: 37.76 },
  },
}

// ─── 이펙트 / UI ───

export const FX: Record<'good' | 'great' | 'ok' | 'btnStart' | 'btnRetry', Frame> = {
  good: { src: A('sheet_effects.png'), sheet: SHEET_FX, rect: [784, 732, 550, 271] },
  great: { src: A('sheet_effects.png'), sheet: SHEET_FX, rect: [88, 536, 543, 241] },
  ok: { src: A('sheet_effects.png'), sheet: SHEET_FX, rect: [1497, 586, 264, 164] },
  btnStart: { src: A('sheet_effects.png'), sheet: SHEET_FX, rect: [106, 178, 738, 235] },
  btnRetry: { src: A('sheet_effects.png'), sheet: SHEET_FX, rect: [1090, 175, 758, 239] },
}

/** 프레임의 원본 비율을 지키는 표시 크기. 폭 또는 높이 하나만 주면 나머지가 계산된다. */
export function frameSize(frame: Frame, opts: { w?: number; h?: number }): { width: number; height: number } {
  const [, , fw, fh] = frame.rect
  if (opts.w != null) return { width: opts.w, height: (opts.w * fh) / fw }
  const h = opts.h ?? fh
  return { width: (h * fw) / fh, height: h }
}

export const TUT_CHAR: Record<Avatar, Frame> = {
  grandma: { src: A('sheet_tut_chars.png'), sheet: SHEET_TUT, rect: [279, 243, 760, 1363] },
  grandfa: { src: A('sheet_tut_chars.png'), sheet: SHEET_TUT, rect: [1403, 218, 664, 1388] },
}

// ─── 마을 ───

export interface Place {
  key: string
  label: string
  x: number
  y: number
  w: number
  h: number
  active: boolean
}

// 좌표는 피그마 2_GameMap 프레임(1920x1080)의 Place_* 노드 그대로.
// 건물 그림은 배경(map_bg)에 이미 그려져 있으므로 히트영역 + 발광만 얹는다.
export const PLACES: Place[] = [
  { key: 'school', label: '초등학교 — 오락가락 청기백기', x: 1400, y: 675, w: 487, h: 388, active: true },
  { key: 'cafe', label: '카페 (준비중)', x: 1212, y: 248, w: 220, h: 237, active: false },
  { key: 'mountain', label: '전망대 (준비중)', x: 186, y: 106, w: 351, h: 188, active: false },
  { key: 'hospital', label: '병원 (준비중)', x: 868, y: 660, w: 454, h: 326, active: false },
  { key: 'mart', label: '마트 (준비중)', x: 1458, y: 211, w: 445, h: 348, active: false },
  { key: 'pharmacy', label: '약국 (준비중)', x: 597, y: 759, w: 297, h: 267, active: false },
  { key: 'bank', label: '은행 (준비중)', x: 904, y: 237, w: 289, h: 311, active: false },
  { key: 'health', label: '보건소 (준비중)', x: 328, y: 329, w: 401, h: 297, active: false },
]
