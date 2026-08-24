import { useEffect, useRef, useState } from 'react'
import { BASE } from '../assets'
import { handEngine, type HandState } from '../game/hand'
import { poseEngine, type PoseMode } from '../game/pose'

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

  if (!state.tracking || !rect || rect.width <= 0 || rect.height <= 0) return null

  // 손 좌표(0~1)는 스테이지 기준 → 실제 화면 좌표로 환산
  const x = rect.left + rect.width * state.x
  const y = rect.top + rect.height * state.y
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

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
/** 커서 좌표(0~1)를 실제 화면 좌표로. 스테이지가 0이면 null */
function toClient(nx: number, ny: number): { x: number; y: number } | null {
  const stage = document.querySelector('.stage')
  if (!stage) return null
  const r = stage.getBoundingClientRect()
  // 창이 최소화되거나 레이아웃이 잠시 멈추면 rect가 0이 되어 좌표가 NaN이 된다.
  if (r.width <= 0 || r.height <= 0) return null
  const x = r.left + r.width * nx
  const y = r.top + r.height * ny
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function mouseEvt(type: string, x: number, y: number, related: Element | null) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    relatedTarget: related,
  })
}

export function useHandControl(enabled: boolean, holdMs = 1000) {
  useEffect(() => {
    if (!enabled) return

    void handEngine.start(holdMs, (nx, ny) => {
      const p = toClient(nx, ny)
      if (!p) return
      const el = document.elementFromPoint(p.x, p.y)
      if (el instanceof HTMLElement) el.click()
    })

    // 커서가 지나가는 곳에 마우스 이동 이벤트를 만들어 준다.
    //
    // 손 커서는 dwell 때 click()만 보내므로, 그대로 두면 호버로 동작하는 UI가
    // 전혀 반응하지 않는다(마을의 스포트라이트·설명 패널이 그랬다).
    // React는 mouseover/mouseout으로 onMouseEnter/onMouseLeave를 합성하므로
    // 커서 아래 요소가 바뀔 때마다 그 둘을 보내면 마우스와 똑같이 동작한다.
    // (CSS :hover는 실제 포인터만 반응하므로, 호버 연출은 상태 기반이어야 한다)
    let hovered: Element | null = null
    let raf = 0
    const track = () => {
      raf = requestAnimationFrame(track)
      const s = handEngine.state()
      if (!s.tracking) {
        if (hovered) {
          hovered.dispatchEvent(mouseEvt('mouseout', 0, 0, null))
          hovered = null
        }
        return
      }
      const p = toClient(s.x, s.y)
      if (!p) return
      const el = document.elementFromPoint(p.x, p.y)
      // 요소가 바뀔 때만 보낸다 (mousemove를 쓰는 곳이 없어 매 프레임 보낼 이유가 없다)
      if (el !== hovered) {
        if (hovered) hovered.dispatchEvent(mouseEvt('mouseout', p.x, p.y, el))
        if (el) el.dispatchEvent(mouseEvt('mouseover', p.x, p.y, hovered))
        hovered = el
      }
    }
    raf = requestAnimationFrame(track)

    return () => {
      cancelAnimationFrame(raf)
      if (hovered) hovered.dispatchEvent(mouseEvt('mouseout', 0, 0, null))
      handEngine.stop()
    }
  }, [enabled, holdMs])
}

/**
 * 화면에 맞는 포즈 인식 모드를 정한다.
 *  - `menu`: 커서만 필요한 화면 → 전체 프레임 1회 추론
 *  - `game`: 2인 동작 판정이 필요한 화면 → 좌/우 절반 2회 추론
 *            (커서는 1P 손목을 재사용하므로 추가 비용 없음)
 * 카메라·모델은 화면이 바뀌어도 유지되므로 모드만 바꾼다.
 */
export function usePoseMode(mode: PoseMode) {
  useEffect(() => {
    void poseEngine.init()
    poseEngine.setMode(mode)
  }, [mode])
}
