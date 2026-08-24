// 배경음악. 구령 재생(Web Audio)과 달리 정밀한 타이밍이 필요 없어 HTMLAudioElement로 반복 재생한다.
//
// 브라우저 자동재생 정책: 사용자 제스처 전에는 재생이 거부된다. 타이틀은 첫 화면이라
// 최초 로드 시점에 제스처가 없다 → play()가 거부되면 첫 입력에 한 번 더 시도한다.
// (결과 → 타이틀로 돌아오는 경우엔 이미 제스처가 있어 바로 재생된다)

export type BgmName = 'opening' | 'tutorial' | 'report'

const FILE: Record<BgmName, string> = {
  opening: '오프닝',
  tutorial: '튜토리얼',
  report: '리포트페이지',
}

let el: HTMLAudioElement | null = null
let current: BgmName | null = null
let pendingGestureHook: (() => void) | null = null

function clearGestureHook() {
  if (!pendingGestureHook) return
  window.removeEventListener('pointerdown', pendingGestureHook)
  window.removeEventListener('keydown', pendingGestureHook)
  pendingGestureHook = null
}

export function playBgm(name: BgmName, volume = 0.45) {
  // 같은 트랙 재요청은 이어서 재생한다(새로 만들지 않는다).
  // 튜토리얼 → 연습처럼 화면이 바뀌어도 음악이 끊기지 않아야 하고,
  // 개발 모드의 StrictMode 이중 호출로 Audio가 두 개 생기는 것도 막는다.
  if (current === name && el) {
    el.volume = volume
    if (el.paused) void el.play().catch(() => undefined)
    return
  }
  stopBgm()
  const a = new Audio(`${import.meta.env.BASE_URL}assets/BGM/${encodeURIComponent(FILE[name])}.mp3`)
  a.loop = true
  a.volume = volume
  el = a
  current = name

  const tryPlay = () => a.play().catch(() => undefined)
  void a.play().catch(() => {
    // 자동재생 거부 → 첫 사용자 입력에 재시도
    const hook = () => {
      clearGestureHook()
      if (current === name) void tryPlay()
    }
    pendingGestureHook = hook
    window.addEventListener('pointerdown', hook, { once: true })
    window.addEventListener('keydown', hook, { once: true })
  })
}

export function stopBgm() {
  clearGestureHook()
  if (el) {
    el.pause()
    el.src = ''
    el = null
  }
  current = null
}

/** 구령이 나오는 구간에서 BGM을 낮췄다 되돌리기 위한 훅 (인게임 BGM 도입 시 사용) */
export function setBgmVolume(v: number) {
  if (el) el.volume = Math.max(0, Math.min(1, v))
}

/** 현재 재생 중인 트랙. 화면별 BGM 배선이 맞는지 확인할 때 쓴다. */
export function currentBgm(): { track: BgmName | null; playing: boolean } {
  return { track: current, playing: !!el && !el.paused }
}

// 개발 중 화면별 BGM 배선을 콘솔에서 바로 확인하기 위한 훅 (프로덕션 빌드에는 포함되지 않는다)
if (import.meta.env.DEV) {
  ;(window as unknown as { __bgm?: unknown }).__bgm = { currentBgm, playBgm, stopBgm }
}
