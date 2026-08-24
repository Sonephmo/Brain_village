import type { CSSProperties } from 'react'
import {
  BODY_ASPECT,
  FACE_ANCHOR,
  FACE_ASPECT,
  bodyFrame,
  faceFrame,
  type Avatar as AvatarId,
  type FaceName,
  type FlagColor,
  type PoseName,
} from '../assets'
import { Sprite } from './Sprite'

// 아바타 = 본체 레이어(캐릭터×깃발색×포즈) + 표정 레이어(캐릭터 공유) — 스펙 §5.1
// 본체는 시트 셀(384x512)을 그대로 쓰므로 포즈가 바뀌어도 머리 위치가 흔들리지 않는다(§5.3 얼굴 앵커 고정).
export function Avatar({
  avatar,
  flag,
  pose,
  face,
  height,
  left,
  top,
  style,
}: {
  avatar: AvatarId
  flag: FlagColor
  pose: PoseName
  face: FaceName
  /** 아바타 높이(px). 폭은 원본 비율 384:512로 자동 계산된다. */
  height: number
  /** 아바타의 가로 중심 위치(px) */
  left: number
  top: number
  style?: CSSProperties
}) {
  const width = height * BODY_ASPECT
  const anchor = FACE_ANCHOR[avatar][pose]
  const faceW = (anchor.width / 100) * width
  const faceH = faceW / FACE_ASPECT

  return (
    <div
      style={{
        position: 'absolute',
        left: left - width / 2,
        top,
        width,
        height,
        ...style,
      }}
    >
      <Sprite frame={bodyFrame(avatar, flag, pose)} style={{ inset: 0 }} />
      <Sprite
        frame={faceFrame(face)}
        style={{
          left: `${anchor.left}%`,
          top: `${anchor.top}%`,
          width: faceW,
          height: faceH,
        }}
      />
    </div>
  )
}

export function poseFromHands(left: boolean, right: boolean): PoseName {
  if (left && right) return 'up'
  // 화면은 거울 모드이므로 참가자의 왼손은 화면 왼쪽에 보인다.
  // 시트 열 'left' = 화면 왼쪽 팔을 든 그림.
  if (left) return 'left'
  if (right) return 'right'
  return 'stand'
}
