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
  if (current === name && el && !el.paused) return
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
