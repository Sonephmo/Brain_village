import type { CSSProperties } from 'react'
import {
  BODY_CANVAS,
  bodySrc,
  facePlacement,
  faceSrc,
  type Avatar as AvatarId,
  type FaceName,
  type FlagColor,
  type PoseName,
} from '../assets'

// 아바타 = 본체 레이어(캐릭터×깃발색×포즈) + 표정 레이어 — 스펙 §5.1
// 분리 전달된 800x800 정사각 원본을 그대로 축소해 쓴다. 시트 크롭이 없으므로
// 옆 프레임이 물려 들어올 여지가 없고, 4개 포즈의 머리 위치도 고정되어 있다(§5.3).
export function Avatar({
  avatar,
  flag,
  pose,
  face,
  size,
  left,
  top,
  style,
}: {
  avatar: AvatarId
  flag: FlagColor
  pose: PoseName
  face: FaceName
  /** 아바타 한 변의 길이(px). 원본이 정사각이라 가로=세로. */
  size: number
  /** 아바타의 가로 중심 위치(px) */
  left: number
  top: number
  style?: CSSProperties
}) {
  const scale = size / BODY_CANVAS
  const f = facePlacement(avatar, flag, face)

  return (
    <div
      style={{
        position: 'absolute',
        left: left - size / 2,
        top,
        width: size,
        height: size,
        ...style,
      }}
    >
      <img
        src={bodySrc(avatar, flag, pose)}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <img
        src={faceSrc(face)}
        alt=""
        style={{
          position: 'absolute',
          left: f.x * scale,
          top: f.y * scale,
          width: f.w * scale,
          height: f.h * scale,
        }}
      />
    </div>
  )
}

export function poseFromHands(left: boolean, right: boolean): PoseName {
  if (left && right) return 'up'
  // 화면은 거울 모드이므로 참가자의 왼손은 화면 왼쪽에 보인다.
  // 'left' = 화면 왼쪽 팔을 든 그림.
  if (left) return 'left'
  if (right) return 'right'
  return 'stand'
}
