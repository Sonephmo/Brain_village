import { useEffect, useRef, useState } from 'react'
import { FX, IMG, TUT_CHAR, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import { poseEngine } from '../game/pose'
import { beep, goodChime, speak } from '../game/audio'

import type { Avatar as AvatarId } from '../assets'

type Step = 'position' | 'calibration' | 'gender'
export type AvatarPick = AvatarId

// 튜토리얼 (디자인 확정 순서): ① 위치잡기 → ② 스트레칭 캘리브레이션 → ③ 성별선택(동작)
// 연습 구령은 GameScreen의 practice 단계에서 진행
export function TutorialScreen({
  onDone,
}: {
  onDone: (avatars: { p1: AvatarPick; p2: AvatarPick }) => void
}) {
  const [step, setStep] = useState<Step>('position')
  const [ok, setOk] = useState<{ p1: boolean; p2: boolean }>({ p1: false, p2: false })
  const [calibProgress, setCalibProgress] = useState(0)
  const [picks, setPicks] = useState<{ p1: AvatarPick | null; p2: AvatarPick | null }>({ p1: null, p2: null })
  const videoRef = useRef<HTMLVideoElement>(null)
  const holdRef = useRef<{ p1: number; p2: number }>({ p1: 0, p2: 0 })
  const calibStartRef = useRef<number | null>(null)
  const genderHoldRef = useRef<{ p1: { hand: 'left' | 'right' | null; since: number }; p2: { hand: 'left' | 'right' | null; since: number } }>({
    p1: { hand: null, since: 0 },
    p2: { hand: null, since: 0 },
  })

  useEffect(() => {
    void poseEngine.init()
  }, [])

  useEffect(() => {
    if (videoRef.current && poseEngine.stream) {
      videoRef.current.srcObject = poseEngine.stream
      void videoRef.current.play().catch(() => undefined)
    }
  })

  // 단계 안내 멘트
  useEffect(() => {
    const lines: Record<Step, string> = {
      position: '얼굴을 원 안에 위치시켜 주세요',
      calibration: '양팔을 3초간 머리 위로 들어주세요',
      gender: '캐릭터를 선택해 주세요. 할머니는 왼손, 할아버지는 오른손을 들어주세요',
    }
    speak(lines[step], false, () => undefined)
  }, [step])

  // 100ms 폴링으로 단계 진행 체크 (판정용이 아니라 UI 진행용)
  useEffect(() => {
    const iv = window.setInterval(() => {
      const now = performance.now()

      if (step === 'position') {
        const check = (pid: 1 | 2) => {
          const p = poseEngine.getPose(pid)
          const inZone = p.present && (p.noseY == null || (p.noseY > 0.1 && p.noseY < 0.7))
          const key = pid === 1 ? 'p1' : 'p2'
          if (inZone) {
            if (!holdRef.current[key]) holdRef.current[key] = now
          } else {
            holdRef.current[key] = 0
          }
          return holdRef.current[key] !== 0 && now - holdRef.current[key] > 1500
        }
        // 카메라 불가(키보드 모드) 시 즉시 통과 가능하도록 완화
        const kb = !poseEngine.cameraOk && poseEngine.ready
        const p1ok = kb || check(1)
        const p2ok = kb || check(2)
        setOk({ p1: p1ok, p2: p2ok })
        if (p1ok && p2ok) {
          goodChime()
          holdRef.current = { p1: 0, p2: 0 }
          setOk({ p1: false, p2: false })
          setStep('calibration')
        }
      }

      if (step === 'calibration') {
        const kb = !poseEngine.cameraOk && poseEngine.ready
        const bothUp = kb
          ? poseEngine.getPose(1).leftRaised && poseEngine.getPose(2).leftRaised
          : poseEngine.bothHandsUpRaw(1) && poseEngine.bothHandsUpRaw(2)
        if (bothUp) {
          if (calibStartRef.current == null) {
            calibStartRef.current = now
            poseEngine.startCalibration()
          }
          const t = (now - calibStartRef.current) / 3000
          setCalibProgress(Math.min(1, t))
          if (t >= 1) {
            poseEngine.finishCalibration()
            goodChime()
            calibStartRef.current = null
            setCalibProgress(0)
            setStep('gender')
          }
        } else {
          calibStartRef.current = null
          setCalibProgress(0)
        }
      }

      if (step === 'gender') {
        for (const pid of [1, 2] as const) {
          const key = pid === 1 ? 'p1' : 'p2'
          if (picks[key]) continue
          const p = poseEngine.getPose(pid)
          const hand = p.leftRaised && !p.rightRaised ? 'left' : p.rightRaised && !p.leftRaised ? 'right' : null
          const g = genderHoldRef.current[key]
          if (hand !== g.hand) {
            g.hand = hand
            g.since = now
          } else if (hand && now - g.since > 1200) {
            const pick: AvatarPick = hand === 'left' ? 'grandma' : 'grandfa'
            beep(880, 120)
            setPicks(prev => ({ ...prev, [key]: pick }))
          }
        }
      }
    }, 100)
    return () => window.clearInterval(iv)
  }, [step, picks])

  // 둘 다 선택 완료 → 연습으로
  useEffect(() => {
    if (picks.p1 && picks.p2) {
      const t = window.setTimeout(() => onDone({ p1: picks.p1!, p2: picks.p2! }), 900)
      return () => window.clearTimeout(t)
    }
  }, [picks, onDone])

  const pickByClick = (pid: 'p1' | 'p2', pick: AvatarPick) => {
    beep(880, 120)
    setPicks(prev => (prev[pid] ? prev : { ...prev, [pid]: pick }))
  }

  return (
    <div className="fill fade-in">
      <img src={IMG.tutBg} alt="" className="fill" style={{ objectFit: 'cover' }} />

      {/* 위치잡기/캘리브레이션은 카메라 강제 ON: 전체 화면 카메라 레이어 */}
      {(step === 'position' || step === 'calibration') && poseEngine.stream && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="fill"
          style={{ objectFit: 'cover', transform: 'scaleX(-1)', opacity: 0.55 }}
        />
      )}
      <div className="divider-line" />

      {step === 'position' && (
        <>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 82, fontSize: 88, textAlign: 'center', color: '#111', textShadow: '0 3px 0 rgba(255,255,255,0.7)' }}>
            얼굴을 원 안에 위치시켜주세요
          </p>
          <img src={IMG.faceZone} alt="" style={{ position: 'absolute', left: 237, top: 287, width: 350, height: 385 }} />
          <img src={IMG.faceZone} alt="" style={{ position: 'absolute', left: 1333, top: 287, width: 350, height: 385 }} />
          {ok.p1 && <Sprite frame={FX.ok} className="pop" style={{ ...frameSize(FX.ok, { w: 266 }), left: 279, top: 700 }} />}
          {ok.p2 && <Sprite frame={FX.ok} className="pop" style={{ ...frameSize(FX.ok, { w: 266 }), left: 1375, top: 700 }} />}
        </>
      )}

      {step === 'calibration' && (
        <>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 42, fontSize: 96, textAlign: 'center', color: '#111', textShadow: '0 3px 0 rgba(255,255,255,0.7)' }}>
            스트레칭
          </p>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 186, fontSize: 64, textAlign: 'center', color: '#111', textShadow: '0 2px 0 rgba(255,255,255,0.7)' }}>
            양팔을 3초간 머리 위로 들어주세요
          </p>
          {/* 진행 게이지: 도달 게이지/링 (스펙 §6) */}
          <div style={{ position: 'absolute', left: '50%', top: 560, transform: 'translateX(-50%)', width: 600, height: 44, background: 'rgba(0,0,0,0.5)', borderRadius: 22, overflow: 'hidden' }}>
            <div style={{ width: `${calibProgress * 100}%`, height: '100%', background: '#37ff83', transition: 'width 0.1s linear' }} />
          </div>
          {calibProgress > 0 && (
            <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 620, fontSize: 52, textAlign: 'center', color: '#fff' }}>
              {Math.ceil(3 - calibProgress * 3)}초...
            </p>
          )}
        </>
      )}

      {step === 'gender' && (
        <>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 18, fontSize: 88, textAlign: 'center', color: '#111', textShadow: '0 3px 0 rgba(255,255,255,0.7)' }}>
            성별선택
          </p>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 162, fontSize: 56, textAlign: 'center', color: '#111', textShadow: '0 2px 0 rgba(255,255,255,0.7)' }}>
            당신의 캐릭터를 선택해주세요
          </p>
          {([1, 2] as const).map(pid => {
            const key = pid === 1 ? 'p1' : 'p2'
            // 각 플레이어 영역(화면 절반)의 중심
            const half = pid === 1 ? 480 : 1440
            const picked = picks[key]
            const opts = [
              { id: 'grandma' as AvatarPick, cx: half - 200, hand: '왼손 들기' },
              { id: 'grandfa' as AvatarPick, cx: half + 200, hand: '오른손 들기' },
            ]
            return (
              <div key={pid}>
                {opts.map(o => {
                  const size = frameSize(TUT_CHAR[o.id], { h: 470 })
                  return (
                    <div key={o.id}>
                      <div
                        onClick={() => pickByClick(key, o.id)}
                        style={{
                          position: 'absolute',
                          left: o.cx - size.width / 2,
                          top: 430,
                          ...size,
                          cursor: 'pointer',
                          outline: picked === o.id ? '8px solid #37ff83' : 'none',
                          borderRadius: 12,
                        }}
                      >
                        <Sprite frame={TUT_CHAR[o.id]} style={{ inset: 0 }} />
                      </div>
                      <p
                        className="pixel-text"
                        style={{ position: 'absolute', left: o.cx - 180, top: 916, width: 360, fontSize: 42, textAlign: 'center', color: '#111', textShadow: '0 2px 0 rgba(255,255,255,0.7)' }}
                      >
                        {o.hand}
                      </p>
                      {picked === o.id && (
                        <Sprite
                          frame={FX.ok}
                          className="pop"
                          style={{ ...frameSize(FX.ok, { w: 240 }), left: o.cx - 120, top: 300 }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </>
      )}

      {/* 진행요원용 스킵 (부스 상황 대비) */}
      <button
        className="pixel-btn secondary staff-skip"
        onClick={() => {
          if (step === 'position') setStep('calibration')
          else if (step === 'calibration') {
            poseEngine.finishCalibration()
            setStep('gender')
          } else onDone({ p1: picks.p1 ?? 'grandma', p2: picks.p2 ?? 'grandfa' })
        }}
      >
        건너뛰기 ▸
      </button>
    </div>
  )
}
