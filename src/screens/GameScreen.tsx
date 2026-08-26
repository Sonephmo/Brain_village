import { useEffect, useRef, useState } from 'react'
import { FX, IMG, frameSize } from '../assets'
import { Avatar, poseFromHands } from '../components/Avatar'
import { CameraPanel } from '../components/CameraPanel'
import { Sprite } from '../components/Sprite'
import { GameRunner, type Snapshot } from '../game/engine'
import { COMMANDS, PRACTICE, PRACTICE_NARRATION, ROUND_SIZE, flagsForCommand } from '../game/commands'
import type { CommandLog } from '../game/types'
import type { FaceName } from '../assets'
import { COUNTDOWN_CUES, COUNTDOWN_TOTAL_MS, beep, playCountdown, playNarration, playSfx, stopNarration } from '../game/audio'
import { playBgm, stopBgm } from '../game/bgm'
import { poseEngine } from '../game/pose'
import { CONTENT_ID, endSession, logCommand, logRoleSwap, startSession } from '../game/telemetry'
import { motionSampler } from '../game/motion'
import { APP_VERSION } from '../game/logging'
import type { AvatarPick } from './TutorialScreen'

type Stage = 'practice' | 'countdown' | 'main' | 'end'

const COUNT_IMGS = [IMG.count3, IMG.count2, IMG.count1, IMG.countStart]

export function GameScreen({
  avatars,
  skipPractice = false,
  onFinish,
}: {
  avatars: { p1: AvatarPick; p2: AvatarPick }
  /** 결과에서 '다시하기'로 돌아온 경우. 같은 팀이 방금 연습을 마쳤으므로 본게임부터 들어간다. */
  skipPractice?: boolean
  onFinish: (logs: CommandLog[], score: number) => void
}) {
  const [stage, setStage] = useState<Stage>(skipPractice ? 'countdown' : 'practice')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [countIdx, setCountIdx] = useState(-1)
  // 중단은 세션을 끝내는 동작이라 오클릭을 막기 위해 두 번 눌러야 실행된다
  const [abortArmed, setAbortArmed] = useState(false)
  const runnerRef = useRef<GameRunner | null>(null)
  const finishRef = useRef(onFinish)
  finishRef.current = onFinish

  // BGM: 연습까지는 튜토리얼 트랙을 이어서 재생하고, 카운트다운부터 본게임은 무음.
  // 구령 청취를 방해하지 않기 위한 결정이다(고령자 대상).
  useEffect(() => {
    if (stage === 'practice') playBgm('tutorial')
    else stopBgm()
  }, [stage])
  useEffect(() => () => stopBgm(), [])

  // 연습 (무채점 5구령, 튜토리얼 배경)
  useEffect(() => {
    if (stage !== 'practice') return
    const runner = new GameRunner({
      commands: PRACTICE,
      scored: false,
      // 연습은 시간으로 끊지 않고 두 사람이 함께 성공할 때까지 기다린다
      waitForSuccess: true,
      onSnapshot: setSnap,
      onFinish: () => {
        setSnap(null)
        setStage('countdown')
      },
    })
    runnerRef.current = runner
    // 화면이 바뀐 것을 참가자가 인지할 최소 시간만 두고 시작한다
    // (안내 음성을 기다리던 3.6초는 TTS 제거로 불필요해졌다)
    const t = window.setTimeout(() => runner.start(), 1200)
    return () => {
      window.clearTimeout(t)
      runner.stop()
    }
  }, [stage])

  // 게임 종료: "끝!" 이미지와 함께 마무리 휘슬
  useEffect(() => {
    if (stage === 'end') playSfx('whistleLong')
  }, [stage])

  /** 진행요원용: 지금까지의 점수로 결과 화면으로. 되돌릴 수 없어 두 번 눌러야 실행된다 */
  const requestAbort = () => {
    if (!abortArmed) {
      setAbortArmed(true)
      window.setTimeout(() => setAbortArmed(false), 4000)
      return
    }
    runnerRef.current?.abort()
  }

  // 진행요원 단축키
  //   1 = 연습에서 현재 구령 건너뛰기 (시간 제한이 없어 막힐 수 있는 구간)
  //   2 = 결과 화면으로 이동. 버튼과 같은 2단계 확인을 거친다 — 세션을 끝내는
  //       동작이라 키 한 번의 오타로 실행되면 안 되고, 화면의 버튼이 무장 상태를
  //       보여주므로 눌렀는지 알 수 있다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1' && stage === 'practice') runnerRef.current?.skipCurrent()
      else if (e.key === '2' && stage === 'main') requestAbort()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 카운트다운 3-2-1-시작 — 음원을 한 번 재생하고 이미지를 소리 지점에 맞춘다.
  // 음원의 소리 간격이 1000ms가 아니라 약 910ms라 실측 큐를 쓴다.
  useEffect(() => {
    if (stage !== 'countdown') return
    const withSound = playCountdown()
    const timers = COUNTDOWN_CUES.map((cue, i) =>
      window.setTimeout(() => {
        setCountIdx(i)
        if (!withSound) beep(i === COUNTDOWN_CUES.length - 1 ? 1320 : 880, 150)
      }, cue),
    )
    const done = window.setTimeout(() => {
      setCountIdx(-1)
      setStage('main')
    }, COUNTDOWN_TOTAL_MS)
    return () => {
      timers.forEach(window.clearTimeout)
      window.clearTimeout(done)
    }
  }, [stage])

  // 본 게임 (2라운드 × 10구령)
  useEffect(() => {
    if (stage !== 'main') return
    // 실시간 전송: 세션 시작 → 구령마다 → 종료. 실패해도 게임은 멈추지 않는다.
    const st = poseEngine.status()
    startSession({
      gameKey: 'orak_flag',
      appVersion: APP_VERSION,
      inputMode: st.keyboardMode && !st.cameraOk ? '키보드' : '포즈인식',
    })
    // 동작 지표는 판정과 별개로 계속 흐른다 (구령 사이·반응 창 밖에도 움직임은 있다)
    motionSampler.start()

    const runner = new GameRunner({
      commands: COMMANDS,
      scored: true,
      roleSwapAfter: ROUND_SIZE - 1,
      onSnapshot: setSnap,
      onCommandLogged: (log, index) =>
        logCommand(log, { contentId: CONTENT_ID, index }),
      onRoleSwap: index => logRoleSwap(index, 1, 2),
      onFinish: (logs, score) => {
        motionSampler.stop() // 남은 창을 닫고 마지막 배치를 올린 뒤 세션을 닫는다
        endSession({
          completed: logs.length >= COMMANDS.length,
          teamScore: score,
          maxScore: COMMANDS.length * 5,
          commandsPlayed: logs.length,
          abortReason: logs.length < COMMANDS.length ? '진행요원 중단' : null,
          poseFps: poseEngine.status().fps,
        })
        setStage('end')
        window.setTimeout(() => finishRef.current(logs, score), 2600)
      },
    })
    runnerRef.current = runner
    runner.start()
    return () => {
      runner.stop()
      motionSampler.stop()
    }
  }, [stage])

  // 연습: 구령이 끝나고 반응 대기가 시작되면 가이드 나레이션을 이어서 들려준다.
  // 시간 제한이 없으므로 안내가 끝날 때까지 기다려도 진행에 지장이 없다.
  const narratedRef = useRef<number | null>(null)
  useEffect(() => {
    if (stage !== 'practice' || snap?.phase !== 'window' || !snap.command) return
    const id = snap.command.id
    if (narratedRef.current === id) return
    narratedRef.current = id
    const key = PRACTICE_NARRATION[id]
    if (key) playNarration(key)
  }, [stage, snap?.phase, snap?.command])
  useEffect(() => {
    if (stage !== 'practice') stopNarration()
  }, [stage])

  const isPractice = stage === 'practice'
  const cmdIndex = snap?.cmdIndex ?? 0
  const flags = isPractice ? { p1: 'blue' as const, p2: 'white' as const } : flagsForCommand(cmdIndex)
  const cmd = snap?.command ?? null
  const judged = snap?.judged ?? null

  // 표정 매핑 (스펙 §5.2): 둘 다 정답 → 웃음 / 나만 정답 → 파트너 쪽 째려보기 / 오답 → 울기
  const faceOf = (me: 'p1' | 'p2'): FaceName => {
    if (!judged) return 'stand'
    const mine = judged[me].correct
    const other = judged[me === 'p1' ? 'p2' : 'p1'].correct
    if (mine && other) return 'good'
    if (mine && !other) return me === 'p1' ? 'angry_right' : 'angry_left'
    return 'sad'
  }

  const poseOf = (me: 'p1' | 'p2') => {
    if (!snap) return 'stand'
    const live = snap.live[me]
    return poseFromHands(live.left, live.right)
  }

  const bg = isPractice ? IMG.tutBg : IMG.gameBg
  // L4 복합 구령("왼손 올리지 말고 둘다 오른손 올려!")은 최대 19자라 한 줄에 안 들어간다.
  // 길이에 따라 글자를 줄여 항상 한 줄로 읽히게 한다.
  const cmdFontSize = (text: string, max: number) => {
    const n = text.length
    if (n <= 8) return max
    if (n <= 12) return Math.round(max * 0.82)
    if (n <= 16) return Math.round(max * 0.68)
    return Math.round(max * 0.56)
  }
  const showEffects = snap?.phase === 'feedback' && judged
  const nCorrect = judged ? (judged.p1.correct ? 1 : 0) + (judged.p2.correct ? 1 : 0) : 0

  return (
    <div className="fill fade-in">
      <img src={bg} alt="" className="fill" style={{ objectFit: 'cover', filter: stage === 'countdown' ? 'blur(5px)' : 'none' }} />
      <div className="divider-line" style={{ top: 212 }} />

      {/* 아바타 (디자인 A Game play 좌표의 가로 중심 기준) */}
      <Avatar avatar={avatars.p1} flag={flags.p1} pose={poseOf('p1')} face={faceOf('p1')} size={499} left={380} top={343} />
      <Avatar avatar={avatars.p2} flag={flags.p2} pose={poseOf('p2')} face={faceOf('p2')} size={499} left={1519} top={343} />

      {/* 구령 텍스트 — 연습은 밝은 tut_bg라 어두운 글씨(디자인 준수), 본게임은 흰 글씨+아웃라인.
          가이드 문장은 연습에서만 노출(본게임 프레임에는 구령만 있음). */}
      {cmd && (snap?.phase === 'speak' || snap?.phase === 'window' || snap?.phase === 'feedback') && (
        <>
          <p
            className="pixel-text"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: isPractice ? 42 : 118,
              fontSize: cmdFontSize(cmd.text, isPractice ? 96 : 140),
              textAlign: 'center',
              whiteSpace: 'nowrap',
              color: isPractice ? '#4a4a4a' : '#fff',
              textShadow: isPractice ? '0 3px 0 rgba(255,255,255,0.8)' : '0 6px 0 rgba(0,0,0,0.55)',
            }}
          >
            {cmd.text}
          </p>
          {/* 페이크 구령: 억양만으로는 난청 참가자에게 불공정 → 테두리로 시각 구분 (스펙 §6) */}
          {cmd.isFake && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: isPractice ? 32 : 106,
                transform: 'translateX(-50%)',
                width: 1240,
                height: isPractice ? 164 : 234,
                border: '10px dashed #ffb43a',
                borderRadius: 20,
                pointerEvents: 'none',
              }}
            />
          )}
          {isPractice && (
            <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 214, fontSize: 62, textAlign: 'center', color: '#111', textShadow: '0 2px 0 rgba(255,255,255,0.75)' }}>
              {cmd.guide}
            </p>
          )}
        </>
      )}

      {/* 반응 창 타이머 (노란 픽셀 숫자, 100ms 단위) */}
      {snap?.phase === 'window' && !isPractice && (
        <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 4, fontSize: 90, textAlign: 'center', color: '#ffd83a', textShadow: '0 4px 0 rgba(0,0,0,0.6)' }}>
          {(snap.windowRemainMs / 1000).toFixed(1)}
        </p>
      )}

      {/* 팀 점수 (본 게임만, 팀 통합 점수 1개 — 스펙 §4.2) */}
      {!isPractice && stage === 'main' && (
        <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 540, fontSize: 110, textAlign: 'center', color: '#4dff7c', textShadow: '0 4px 0 rgba(0,0,0,0.6)' }}>
          {String(snap?.score ?? 0).padStart(2, '0')}
        </p>
      )}

      {/* 진행 표시 */}
      {!isPractice && stage === 'main' && cmd && (
        <p className="pixel-text" style={{ position: 'absolute', right: 40, top: 20, fontSize: 44, color: '#fff', textShadow: '0 3px 0 rgba(0,0,0,0.6)' }}>
          {cmdIndex + 1} / {COMMANDS.length}
        </p>
      )}
      {isPractice && (
        <p className="pixel-text" style={{ position: 'absolute', right: 40, top: 20, fontSize: 44, color: '#8a5a00', textShadow: '0 2px 0 rgba(255,255,255,0.7)' }}>
          연습 {Math.min(cmdIndex + 1, PRACTICE.length)} / {PRACTICE.length}
        </p>
      )}

      {/* 피드백 이펙트: 정답자 아래 Good, 둘 다 정답이면 중앙 Great. 오답은 표정으로만 (스펙 §6) */}
      {showEffects && judged && (
        <>
          {judged.p1.correct && (
            <Sprite frame={FX.good} className="pop" style={{ ...frameSize(FX.good, { w: 460 }), left: 150, top: 880 }} />
          )}
          {judged.p2.correct && (
            <Sprite frame={FX.good} className="pop" style={{ ...frameSize(FX.good, { w: 460 }), left: 1310, top: 880 }} />
          )}
          {nCorrect === 2 && (
            <Sprite
              frame={FX.great}
              className="pop"
              style={{ ...frameSize(FX.great, { w: 620 }), left: '50%', top: 700, transform: 'translateX(-50%)' }}
            />
          )}
        </>
      )}

      {/* 역할 교체 안내 */}
      {snap?.phase === 'roleswap' && (
        <div className="fill fade-in" style={{ background: 'rgba(0,0,0,0.86)', zIndex: 30 }}>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 200, fontSize: 110, textAlign: 'center', color: '#fff' }}>
            역할을 바꿔요!
          </p>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 360, fontSize: 60, textAlign: 'center', color: '#ffd83a' }}>
            이제 1P는 백기, 2P는 청기입니다
          </p>
          <Avatar avatar={avatars.p1} flag="white" pose="up" face="good" size={420} left={470} top={480} />
          <Avatar avatar={avatars.p2} flag="blue" pose="up" face="good" size={420} left={1450} top={480} />
        </div>
      )}

      {/* 카운트다운 */}
      {stage === 'countdown' && countIdx >= 0 && (
        <img src={COUNT_IMGS[countIdx]} alt="" className="pop" style={{ position: 'absolute', left: 824, top: 417, width: 246, height: 246 }} key={countIdx} />
      )}

      {/* 종료 */}
      {stage === 'end' && (
        <img src={IMG.end} alt="끝!" className="pop" style={{ position: 'absolute', left: 629, top: 301, width: 777, height: 583 }} />
      )}

      {/* 연습: 시간 제한이 없으므로 각자 지금 자세가 맞는지 보여준다 */}
      {isPractice && snap?.phase === 'window' && (
        <>
          {(['p1', 'p2'] as const).map(pid => {
            const ok = snap.practiceOk[pid]
            return (
              <p
                key={pid}
                className="pixel-text"
                style={{
                  position: 'absolute',
                  left: pid === 'p1' ? 130 : 1290,
                  width: 500,
                  top: 880,
                  fontSize: 46,
                  textAlign: 'center',
                  color: ok ? '#1f9d4d' : '#8a5a00',
                  textShadow: '0 2px 0 rgba(255,255,255,0.8)',
                }}
              >
                {ok ? '좋아요! 그대로' : '따라해 보세요'}
              </p>
            )
          })}
          {/* 부스에서 동작 인식이 안 되는 참가자가 있어도 진행이 막히지 않도록 하는 예비 수단 */}
          <button className="pixel-btn secondary staff-skip" onClick={() => runnerRef.current?.skipCurrent()}>
            이 구령 건너뛰기 ▸ (1)
          </button>
        </>
      )}

      {/* 진행요원용 중단 (참가자 이탈 등). 지금까지의 점수로 결과 화면으로 넘어간다 */}
      {stage === 'main' && (
        <button
          className="pixel-btn secondary staff-skip"
          style={abortArmed ? { opacity: 1, background: '#ffd0d0' } : undefined}
          onClick={requestAbort}
        >
          {abortArmed ? '한 번 더 누르면 중단 (2)' : '중단하기 ▸ (2)'}
        </button>
      )}

      {/* 카메라 (중앙 하단, ON/OFF 토글 가능) */}
      <CameraPanel style={{ left: 629, top: 708, width: 661, height: 372 }} />
    </div>
  )
}
