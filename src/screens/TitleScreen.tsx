import { useEffect, useState } from 'react'
import { FX, IMG, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import { beep, initAudio } from '../game/audio'
import { playBgm, stopBgm } from '../game/bgm'
import { cameraError, cameraStream } from '../game/camera'
import { playerAuth, siteAuth } from '../game/auth'

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

export function TitleScreen({
  onStart,
  onLogoutSite,
  onLogoutPlayers,
}: {
  onStart: () => void
  /** 기관 로그아웃 — 부스를 닫을 때. 개인 로그인도 함께 지워진다 */
  onLogoutSite: () => void
  /** 개인 로그아웃 — 다음 팀을 받을 때 */
  onLogoutPlayers: () => void
}) {
  const [introDone, setIntroDone] = useState(false)
  const site = siteAuth()
  const players = playerAuth()

  // 손 커서는 App에서 전역으로 켠다(모든 화면에서 유효).
  // 인트로 중 주먹은 인트로 스킵으로 동작한다(배경 클릭과 같다).

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

      {/* 로그인 상태 + 로그아웃 (진행요원용).
          '홈으로'로 돌아온 다음 팀은 여기서 개인 로그아웃을 눌러 번호를 다시 받는다.
          인트로 중에는 참가자가 잘못 누르지 않게 감춘다. */}
      {introDone && (site || players) && (
        <div className="auth-badge" onClick={e => e.stopPropagation()}>
          <span className="pixel-text" style={{ fontSize: 22, color: '#e8e8e8' }}>
            {site ? site.siteName : '기관 미로그인'}
            {players ? ` · 1P ${players.p1} / 2P ${players.p2}` : ' · 참가자 미확인'}
          </span>
          {players && <button onClick={onLogoutPlayers}>개인 로그아웃</button>}
          {site && <button onClick={onLogoutSite}>기관 로그아웃</button>}
        </div>
      )}

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
