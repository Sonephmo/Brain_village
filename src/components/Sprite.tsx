import type { CSSProperties } from 'react'
import type { Frame } from '../assets'

// 시트의 한 프레임만 보여주는 렌더러.
// background-size/position을 %로 계산하므로 컨테이너 픽셀 크기를 몰라도 정확하다.
//   scaled image width = C * sheetW/w  →  offset = -x*C/w  →  position% = x/(sheetW-w)
export function Sprite({
  frame,
  style,
  className,
}: {
  frame: Frame
  style?: CSSProperties
  className?: string
}) {
  const [sw, sh] = frame.sheet
  const [x, y, w, h] = frame.rect
  const px = sw === w ? 0 : (x / (sw - w)) * 100
  const py = sh === h ? 0 : (y / (sh - h)) * 100
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        backgroundImage: `url("${frame.src}")`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${(sw / w) * 100}% ${(sh / h) * 100}%`,
        backgroundPosition: `${px}% ${py}%`,
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  )
}

/** 프레임의 원본 비율(가로/세로) */
export function frameAspect(frame: Frame): number {
  return frame.rect[2] / frame.rect[3]
}
