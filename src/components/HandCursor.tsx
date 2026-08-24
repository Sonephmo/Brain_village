import { useEffect, useRef, useState } from 'react'
import { BASE } from '../assets'
import { handEngine, type HandState } from '../game/hand'

// 손으로 조작하는 커서.
// 커서 그림은 마우스 커서와 같은 에셋을 쓴다(펼친 손 / 주먹).
// 주먹을 유지하는 동안 커서 아래에 진행 바가 차오르고, 다 차면 클릭이 발생한다.

const CURSOR_W = 120 // 스테이지(1920x1080) 기준 크기 — 고령자가 보기 쉽게 크게
const CURSOR_H = 192
const HOTSPOT_X = 0.475 // 이미지 내 손끝 가로 위치 비율 (19/40)
const BAR_W = 150
const BAR_H = 18

export function HandCursor() {
  const [state, setState] = useState<HandState>(() => handEngine.state())
  const raf = useRef(0)

  // 손 좌표는 rAF로 읽는다. 60fps로 setState 하면 렌더가 과해지므로
  // 값이 의미 있게 바뀔 때만 갱신한다.
  useEffect(() => {
    let prev = handEngine.state()
    const tick = () => {
      raf.current = requestAnimationFrame(tick)
      const s = handEngine.state()
      const moved = Math.abs(s.x - prev.x) > 0.002 || Math.abs(s.y - prev.y) > 0.002
      const changed =
        s.tracking !== prev.tracking ||
        s.fist !== prev.fist ||
        Math.abs(s.progress - prev.progress) > 0.02
      if (moved || changed) {
        prev = s
        setState(s)
      }
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  if (!state.tracking) return null

  const left = state.x * 1920
  const top = state.y * 1080

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 90 }}>
      <img
        src={`${BASE}assets/${state.fist ? 'Cursor_Selecting' : 'Cursor_Idle'}.png`}
        alt=""
        style={{
          position: 'absolute',
          left: left - CURSOR_W * HOTSPOT_X,
          top,
          width: CURSOR_W,
          height: CURSOR_H,
          imageRendering: 'pixelated',
          filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.45))',
        }}
      />
      {/* 주먹 유지 진행 바 — 커서 아래 */}
      {state.progress > 0 && (
        <div
          style={{
            position: 'absolute',
            left: left - BAR_W / 2,
            top: top + CURSOR_H + 10,
            width: BAR_W,
            height: BAR_H,
            background: 'rgba(0,0,0,0.55)',
            border: '3px solid rgba(255,255,255,0.85)',
            borderRadius: BAR_H,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${state.progress * 100}%`,
              height: '100%',
              background: state.progress >= 1 ? '#ffd83a' : '#37ff83',
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 손 인식을 켜고, 주먹 유지가 끝나면 그 지점의 요소를 클릭한다.
 * 스테이지 좌표(1920x1080) → 실제 화면 좌표로 변환해 elementFromPoint로 찾는다.
 * 기존 onClick 핸들러가 그대로 동작하므로 화면별 추가 배선이 필요 없다.
 */
export function useHandControl(enabled: boolean, holdMs = 1000) {
  useEffect(() => {
    if (!enabled) return
    void handEngine.start(holdMs, (nx, ny) => {
      const stage = document.querySelector('.stage')
      if (!stage) return
      const r = stage.getBoundingClientRect()
      const cx = r.left + r.width * nx
      const cy = r.top + r.height * ny
      const el = document.elementFromPoint(cx, cy)
      if (el instanceof HTMLElement) el.click()
    })
    return () => handEngine.stop()
  }, [enabled, holdMs])
}
