import type { CSSProperties } from 'react'
import { BODY, FACE, FACE_LAYOUT, type FaceName, type FlagColor, type PoseName } from '../assets'
import { Sprite } from './Sprite'

// 아바타 = 바디 레이어(성별×깃발색×포즈) + 표정 레이어(성별 공유) — 스펙 §5.1
// avatar: 참가자가 고른 캐릭터. grandma → 피그마 ma_* 시트, grandfa → fa_* 시트
export function Avatar({
  avatar,
  flag,
  pose,
  face,
  size,
  style,
}: {
  avatar: 'grandma' | 'grandfa'
  flag: FlagColor
  pose: PoseName
  face: FaceName
  size: number
  style?: CSSProperties
}) {
  const gender = avatar === 'grandma' ? 'ma' : 'fa'
  const body = BODY[gender][flag][pose]
  return (
    <div style={{ position: 'absolute', width: size, height: size, ...style }}>
      <Sprite crop={body} style={{ inset: 0 }} />
      <Sprite
        crop={FACE[face]}
        style={{
          left: `${FACE_LAYOUT.left}%`,
          top: `${FACE_LAYOUT.top}%`,
          width: `${FACE_LAYOUT.size}%`,
          height: `${FACE_LAYOUT.size}%`,
        }}
      />
    </div>
  )
}

export function poseFromHands(left: boolean, right: boolean): PoseName {
  if (left && right) return 'up'
  if (left) return 'left'
  if (right) return 'right'
  return 'stand'
}
