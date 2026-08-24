import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { poseEngine } from '../game/pose'

// 카메라 화면: 거울 모드 + 중앙 분할선. 튜토리얼 위치잡기/캘리브레이션 구간은 강제 ON(스펙 §6)
export function CameraPanel({
  style,
  forceOn = false,
}: {
  style?: CSSProperties
  forceOn?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(true)
  const visible = forceOn || on

  useEffect(() => {
    if (videoRef.current && poseEngine.stream && visible) {
      videoRef.current.srcObject = poseEngine.stream
      void videoRef.current.play().catch(() => undefined)
    }
  }, [visible])

  return (
    <div className="camera-panel" style={style}>
      {visible && poseEngine.stream ? (
        <>
          <video ref={videoRef} muted playsInline />
          <div className="camera-split" />
        </>
      ) : (
        <div
          className="pixel-text"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontSize: 30,
          }}
        >
          {poseEngine.stream ? '카메라 꺼짐' : '카메라 없음 (키보드 모드)'}
        </div>
      )}
      {!forceOn && poseEngine.stream && (
        <button
          className="pixel-btn secondary"
          style={{ position: 'absolute', right: 8, top: 8, fontSize: 20, padding: '4px 12px', zIndex: 5 }}
          onClick={() => setOn(v => !v)}
        >
          {visible ? '카메라 끄기' : '카메라 켜기'}
        </button>
      )}
    </div>
  )
}
