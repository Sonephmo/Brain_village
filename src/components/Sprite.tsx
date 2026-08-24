import type { CSSProperties } from 'react'
import type { Crop } from '../assets'

// 피그마 노드의 크롭값(%)을 그대로 재현하는 스프라이트 렌더러
export function Sprite({ crop, style, className }: { crop: Crop; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none', ...style }}>
      <img
        src={crop.src}
        alt=""
        style={{
          position: 'absolute',
          width: `${crop.w}%`,
          height: `${crop.h}%`,
          left: `${crop.l}%`,
          top: `${crop.t}%`,
          maxWidth: 'none',
        }}
      />
    </div>
  )
}
