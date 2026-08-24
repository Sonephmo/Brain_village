import { useEffect, useRef, useState } from 'react'
import { BASE } from '../assets'
import { handEngine, type HandState } from '../game/hand'

// 손으로 조작하는 커서.
//
// 마우스 커서와 **완전히 같아야** 하므로:
//  - 같은 파일을 쓴다 (Cursor_Idle_cur.png / Cursor_Selecting_cur.png, 81x128)
//  - 같은 픽셀 크기로 그린다 → 스테이지(1920x1080) 안에 두면 화면 배율만큼 커지므로
//    **화면 좌표 고정(position: fixed) 오버레이**로 그린다.
//  - 같은 핫스팟(38,0)을 쓴다.
// 원본 362x362 정사각을 세로로 늘려 그리면 비율이 깨진다 — 크롭본(81x128)을 그대로 쓴다.

const CURSOR_W = 81
const CURSOR_H = 128
const HOTSPOT_X = 38 // px, 가운뎃손가락 끝
const BAR_W = 110
const BAR_H = 14

export function HandCursor() {
  const [state, setState] = useState<HandState>(() => handEngine.state())
  const [rect, setRect] = useState<DOMRect | null>(null)
  const raf = useRef(0)

  // 손 좌표는 rAF로 읽되, 의미 있게 바뀔 때만 렌더한다.
  // 스테이지 위치도 함께 읽어 창 크기가 바뀌어도 커서가 따라간다.
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
        const stage = document.querySelector('.stage')
        if (stage) setRect(stage.getBoundingClientRect())
      }
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  if (!state.tracking || !rect) return null

  // 손 좌표(0~1)는 스테이지 기준 → 실제 화면 좌표로 환산
  const x = rect.left + rect.width * state.x
  const y = rect.top + rect.height * state.y

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9000 }}>
      <img
        src={`${BASE}assets/${state.fist ? 'Cursor_Selecting' : 'Cursor_Idle'}_cur.png`}
        alt=""
        style={{
          position: 'fixed',
          left: x - HOTSPOT_X,
          top: y,
          width: CURSOR_W,
          height: CURSOR_H,
          imageRendering: 'pixelated',
          filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.5))',
        }}
      />
      {/* 주먹 유지 진행 바 — 커서 아래 */}
      {state.progress > 0 && (
        <div
          style={{
            position: 'fixed',
            left: x - BAR_W / 2,
            top: y + CURSOR_H + 6,
            width: BAR_W,
            height: BAR_H,
            background: 'rgba(0,0,0,0.6)',
            border: '2px solid rgba(255,255,255,0.9)',
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
 * 스테이지 좌표(0~1) → 실제 화면 좌표로 변환해 elementFromPoint로 찾는다.
 * 기존 onClick 핸들러가 그대로 동작하므로 화면별 추가 배선이 필요 없다.
 */
export function useHandControl(enabled: boolean, holdMs = 1000) {
  useEffect(() => {
    if (!enabled) return
    void handEngine.start(holdMs, (nx, ny) => {
      const stage = document.querySelector('.stage')
      if (!stage) return
      const r = stage.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width * nx, r.top + r.height * ny)
      if (el instanceof HTMLElement) el.click()
    })
    return () => handEngine.stop()
  }, [enabled, holdMs])
}
