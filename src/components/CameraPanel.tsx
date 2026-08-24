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
  const [hasStream, setHasStream] = useState(!!poseEngine.stream)
  const visible = forceOn || on

  // 카메라 획득은 비동기라, 스트림이 생기면 뒤늦게라도 패널을 띄운다
  useEffect(() => {
    if (hasStream) return
    const iv = window.setInterval(() => {
      if (poseEngine.stream) {
        setHasStream(true)
        window.clearInterval(iv)
      }
    }, 500)
    return () => window.clearInterval(iv)
  }, [hasStream])

  useEffect(() => {
    if (videoRef.current && poseEngine.stream && visible) {
      videoRef.current.srcObject = poseEngine.stream
      void videoRef.current.play().catch(() => undefined)
    }
  }, [visible, hasStream])

  // 카메라가 없으면(키보드 모드) 검은 박스로 화면을 가리지 않는다
  if (!hasStream) return null

  return (
    <div className="camera-panel" style={style}>
      {visible ? (
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
          카메라 꺼짐
        </div>
      )}
      {!forceOn && (
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
