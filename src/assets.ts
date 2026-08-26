// 에셋 매니페스트.
//
// 아바타(본체·표정)는 `assets/Sprite/` 에 **낱장으로 분리 전달된 원본**을 그대로 쓴다.
// 이전에 쓰던 스프라이트 시트는 프레임 간격이 불균일해 옆 프레임 깃발이 물려 들어왔고
// 포즈마다 머리가 움직여 표정 앵커를 포즈별로 잡아야 했다. 분리본은 두 문제가 모두 없다.
//
// 시트로 남아 있는 것(이펙트·튜토리얼 캐릭터)은 캔버스로 실측한 자연 픽셀 좌표를 쓴다.

export const BASE = import.meta.env.BASE_URL
const A = (n: string) => `${BASE}assets/${n}`

/** 시트에서 잘라낼 자연 픽셀 사각형. 컨테이너 크기와 무관하게 CSS %로 렌더된다. */
export interface Frame {
  src: string
  sheet: [number, number]
  rect: [number, number, number, number] // x, y, w, h
}

export const IMG = {
  count1: A('count1.png'),
  count2: A('count2.png'),
  count3: A('count3.png'),
  countStart: A('count_start.png'),
  end: A('end.png'),
  mapBg: A('map_bg.png'),
  tutBg: A('tut_bg.png'),
  gameBg: A('game_bg.png'),
  faceZone: A('face_zone.png'),
  titleMain: A('title_main.jpg'),
  titleLogo: A('title_logo.png'),
}

const SHEET_FX: [number, number] = [1920, 1080]
const SHEET_TUT: [number, number] = [2400, 1792]

// ─── 아바타 본체 ───

/** 참가자가 고르는 캐릭터. 파일 접두사 ma_* = 할머니, fa_* = 할아버지 */
export type Avatar = 'grandma' | 'grandfa'
export type FlagColor = 'blue' | 'white'
export type PoseName = 'stand' | 'up' | 'left' | 'right'

/** 본체·표정 원본 캔버스는 정사각 800x800이다. */
export const BODY_CANVAS = 800

// 분리 전달된 본체 파일. 파일명은 전부 `_up`이지만 실제 포즈는 파일마다 다르고,
// **번호와 포즈의 대응이 캐릭터별로 뒤바뀌어 있다**(깃발 픽셀 위치로 실측한 결과).
//   할머니(ma_*):   base=up, -1=left, -2=right, -3=stand
//   할아버지(fa_*): base=up, -1=right, -2=left, -3=stand
// 파일명을 신뢰할 수 없으므로 이 표가 유일한 진실이다. 재전달 시 반드시 재확인할 것.
const BODY_FILE: Record<Avatar, Record<FlagColor, Record<PoseName, string>>> = {
  grandma: {
    blue: {
      up: 'ma_blue_up_selected',
      left: 'ma_blue_up_selected-1',
      right: 'ma_blue_up_selected-2',
      stand: 'ma_blue_up_selected-3',
    },
    white: { up: 'ma_white_up', left: 'ma_white_up-1', right: 'ma_white_up-2', stand: 'ma_white_up-3' },
  },
  grandfa: {
    blue: { up: 'fa_blue_up', right: 'fa_blue_up-1', left: 'fa_blue_up-2', stand: 'fa_blue_up-3' },
    white: { up: 'fa_white_up', right: 'fa_white_up-1', left: 'fa_white_up-2', stand: 'fa_white_up-3' },
  },
}

export function bodySrc(avatar: Avatar, flag: FlagColor, pose: PoseName): string {
  return `${BASE}assets/Sprite/${BODY_FILE[avatar][flag][pose]}.png`
}

// ─── 표정 ───

export type FaceName = 'stand' | 'good' | 'angry_left' | 'angry_right' | 'sad'

/** 표정 원본 크기. face_good만 295x296이고 나머지는 300x300이다. */
const FACE_SIZE: Record<FaceName, [number, number]> = {
  stand: [300, 300],
  good: [295, 296],
  angry_left: [300, 300],
  angry_right: [300, 300],
  sad: [300, 300],
}

export function faceSrc(face: FaceName): string {
  return `${BASE}assets/Sprite/face_${face}.png`
}

/**
 * 800x800 본체 캔버스 안에서 표정 레이어를 놓을 위치(px). 디자이너가 준 레이아웃 CSS 값 그대로.
 *
 * 분리 전달본에서는 4개 포즈의 머리 위치가 고정되어(실측 편차 ≤12px, 캔버스의 1.5%)
 * 캐릭터·깃발색당 하나의 앵커로 충분하다 — 스펙 §5.3이 요구한 상태다.
 * 깃발색에 따라 값이 다른 것은 백기 쪽 인물이 캔버스에서 약간 아래에 그려져 있기 때문.
 */
const FACE_PLACE: Record<Avatar, Record<FlagColor, { x: number; y: number }>> = {
  grandma: { blue: { x: 247, y: 103 }, white: { x: 247, y: 121 } },
  grandfa: { blue: { x: 247, y: 84 }, white: { x: 251, y: 100 } },
}
/** face_good은 5px 좁고 4px 낮아, 같은 자리에 맞추려면 이만큼 밀어야 한다(디자이너 CSS 기준). */
const GOOD_OFFSET = { x: 5, y: 2 }

/** 800x800 캔버스 기준 표정 레이어의 위치·크기(px) */
export function facePlacement(
  avatar: Avatar,
  flag: FlagColor,
  face: FaceName,
): { x: number; y: number; w: number; h: number } {
  const p = FACE_PLACE[avatar][flag]
  const [w, h] = FACE_SIZE[face]
  const d = face === 'good' ? GOOD_OFFSET : { x: 0, y: 0 }
  return { x: p.x + d.x, y: p.y + d.y, w, h }
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

// ─── 결과(리포트) 화면 ───
//
// 피그마 Result 프레임(121:497)에 놓인 이미지들. 노드마다 이미지 채움이 **손으로 크롭**되어
// 있고 일부는 가로·세로 배율이 서로 달라(다시하기 버튼이 9% 정도) 단순 축소로는 맞지 않는다.
// 그래서 크롭 비율을 자연 픽셀 사각형으로 환산해 두었다. Sprite가 rect를 컨테이너 크기에
// 늘려 그리므로 피그마 화면과 동일하게 보인다.
const RESULT_BTN_SHEET: [number, number] = [2172, 724]
const F = (name: string, sheet: [number, number], rect: [number, number, number, number]): Frame => ({
  src: A(name),
  sheet,
  rect,
})

export const RESULT: Record<'banner' | 'scorePanel' | 'feedbackPanel' | 'btnRetry' | 'btnYes' | 'btnHome', Frame> = {
  banner: F('result_banner.png', RESULT_BTN_SHEET, [50, 75, 2073, 568]),
  scorePanel: F('result_score_panel.png', [1536, 1024], [27, 168, 1482, 640]),
  feedbackPanel: F('result_feedback_panel.png', [1448, 1086], [23, 157, 1402, 728]),
  btnRetry: F('btn_retry.png', RESULT_BTN_SHEET, [163, 95, 1846, 534]),
  btnYes: F('btn_yes.png', RESULT_BTN_SHEET, [287, 122, 1597, 426]),
  btnHome: F('btn_home.png', RESULT_BTN_SHEET, [202, 68, 1768, 546]),
}

// 상품 원본은 5장 모두 1254x1254 정사각이고 구도도 같다.
// 크롭은 Result 프레임에 실제로 놓인 80score 노드 것을 5장에 공통으로 쓴다
// (구간별 낱장 프레임에는 designer가 느슨하게 잡은 크롭이 각각 달라 슬롯에 넣으면 비율이 깨진다).
const PRIZE_SHEET: [number, number] = [1254, 1254]
const PRIZE_RECT: [number, number, number, number] = [46, 8, 1162, 1152]

export interface Prize {
  /** 이 점수 이상이면 이 상품 */
  min: number
  name: string
  frame: Frame
}

/** 높은 점수부터. 90점은 마을 오버레이 내러티브(1등팀 89점)와 맞물린다. */
export const PRIZES: Prize[] = [
  { min: 90, name: '제주도 여행권', frame: F('prize_90.png', PRIZE_SHEET, PRIZE_RECT) },
  { min: 80, name: '고급 한우 선물 세트', frame: F('prize_80.png', PRIZE_SHEET, PRIZE_RECT) },
  { min: 60, name: '홍삼 선물 세트', frame: F('prize_60.png', PRIZE_SHEET, PRIZE_RECT) },
  { min: 40, name: '과일 선물 세트', frame: F('prize_40.png', PRIZE_SHEET, PRIZE_RECT) },
  // 20점 미만도 참가상으로 수건 세트를 준다 (디자인에 20 아래 구간 그림이 없다)
  { min: 0, name: '수건 세트', frame: F('prize_20.png', PRIZE_SHEET, PRIZE_RECT) },
]

export function prizeFor(score: number): Prize {
  return PRIZES.find(p => score >= p.min) ?? PRIZES[PRIZES.length - 1]
}
