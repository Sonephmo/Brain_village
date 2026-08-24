import { useEffect, useState } from 'react'
import { FX, IMG, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import { beep, initAudio } from '../game/audio'
import { playBgm, stopBgm } from '../game/bgm'
import { useHandControl } from '../components/HandCursor'
import { cameraError, cameraStream } from '../game/camera'

// 피그마 1_MainTitle 프레임. 좌표·크기는 디자인 CSS 값 그대로.
//   Image_Main          1920x2075  (0, -23)   ← 프레임보다 커서 위로 패닝된다
//   Title_BrainVillage  1292x727   (314, -23)
//   Button_Start        663x228    (629, 752)
//
// 인트로는 디자인의 6초 타임라인(1회 재생)을 그대로 재현한다.
//   Image_Main   y 0 → -792px        0 ~ 5.0s
//   Title 로고   opacity 0 → 1    3.97 ~ 5.0s
//   Button_Start opacity 0 → 1    4.94 ~ 5.69s
// 부스에서 참가자가 바뀔 때마다 6초를 기다리지 않도록, 화면을 누르면 인트로를 끝낸다.
const INTRO_MS = 6000
const BTN = frameSize(FX.btnStart, { w: 663 })

export function TitleScreen({ onStart }: { onStart: () => void }) {
  const [introDone, setIntroDone] = useState(false)

  // 1P 오른손으로 커서를 움직이고, 주먹을 1초 유지하면 클릭한다.
  // **인트로가 끝나기를 기다리지 않고 바로 시작한다** — 모델 로드(0.8초)와
  // GPU 워밍업(최대 4.8초)이 있어, 인트로 후에 켜면 커서가 11초쯤 뒤에 나타난다.
  // 인트로 중 주먹은 인트로 스킵으로 동작한다(배경 클릭과 같다).
  useHandControl(true, 1000)

  // 카메라 실패 여부는 비동기로 결정되므로 잠시 뒤 확인한다
  const [camFailed, setCamFailed] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setCamFailed(!!cameraError() && !cameraStream()), 4000)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setIntroDone(true), INTRO_MS)
    return () => window.clearTimeout(t)
  }, [])

  // 오프닝 BGM은 타이틀에서만 재생하고 화면을 벗어나면 멈춘다
  useEffect(() => {
    playBgm('opening')
    return () => stopBgm()
  }, [])

  const start = () => {
    beep(880, 100)
    // 브라우저는 사용자 제스처 없이 오디오를 재생할 수 없다.
    // 이 클릭이 유일하게 보장된 제스처이므로 여기서 해금하고 구령 클립을 미리 받아둔다.
    void initAudio()
    onStart()
  }

  return (
    <div
      className="fill"
      style={{ background: '#FFFFFF' }}
      onClick={() => {
        // 인트로 중 클릭은 스킵으로만 쓰고 게임을 시작하지 않는다(오터치 방지)
        if (!introDone) setIntroDone(true)
      }}
    >
      <img
        src={IMG.titleMain}
        alt=""
        className={introDone ? undefined : 'intro-pan'}
        style={{
          position: 'absolute',
          left: 0,
          top: -23,
          width: 1920,
          height: 2075,
          objectFit: 'cover',
          transform: introDone ? 'translateY(-792px)' : undefined,
        }}
      />
      <img
        src={IMG.titleLogo}
        alt="브레인빌리지"
        className={introDone ? undefined : 'intro-logo'}
        style={{
          position: 'absolute',
          left: 314,
          top: -23,
          width: 1292,
          height: 727,
          objectFit: 'cover',
          opacity: introDone ? 1 : undefined,
        }}
      />
      <div
        role="button"
        aria-label="시작하기"
        className={introDone ? undefined : 'intro-btn'}
        style={{
          position: 'absolute',
          left: 629,
          top: 752 + (228 - BTN.height) / 2,
          ...BTN,
          opacity: introDone ? 1 : undefined,
          // 인트로 중에는 버튼이 보이지 않으므로 클릭도 받지 않는다
          pointerEvents: introDone ? 'auto' : 'none',
        }}
        onClick={e => {
          e.stopPropagation()
          // pointer-events:none는 실제 포인터만 막는다. 키보드 Enter나 보조기술이 보내는
          // 클릭으로 인트로 중에 게임이 시작되지 않도록 핸들러에서도 막는다.
          if (!introDone) {
            setIntroDone(true)
            return
          }
          start()
        }}
      >
        <Sprite frame={FX.btnStart} style={{ inset: 0 }} />
      </div>

      {/* 카메라를 못 열었으면 진행요원이 알 수 있게 알린다 (마우스로는 계속 진행 가능) */}
      {introDone && camFailed && (
        <p
          className="pixel-text"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 24,
            fontSize: 28,
            textAlign: 'center',
            color: '#ffd0d0',
            textShadow: '0 2px 0 rgba(0,0,0,0.7)',
          }}
        >
          카메라를 사용할 수 없어 손 조작이 꺼졌습니다 — 마우스로 진행하세요
        </p>
      )}
    </div>
  )
}
