import { useEffect, useRef, useState } from 'react'
import { FX, IMG, frameSize } from '../assets'
import { Avatar, poseFromHands } from '../components/Avatar'
import { CameraPanel } from '../components/CameraPanel'
import { Sprite } from '../components/Sprite'
import { GameRunner, type Snapshot } from '../game/engine'
import { COMMANDS, PRACTICE, ROUND_SIZE, flagsForCommand } from '../game/commands'
import type { CommandLog } from '../game/types'
import type { FaceName } from '../assets'
import { beep, speak } from '../game/audio'
import type { AvatarPick } from './TutorialScreen'

type Stage = 'practice' | 'countdown' | 'main' | 'end'

const COUNT_IMGS = [IMG.count3, IMG.count2, IMG.count1, IMG.countStart]

export function GameScreen({
  avatars,
  onFinish,
}: {
  avatars: { p1: AvatarPick; p2: AvatarPick }
  onFinish: (logs: CommandLog[], score: number) => void
}) {
  const [stage, setStage] = useState<Stage>('practice')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [countIdx, setCountIdx] = useState(-1)
  const runnerRef = useRef<GameRunner | null>(null)
  const finishRef = useRef(onFinish)
  finishRef.current = onFinish

  // 연습 (무채점 5구령, 튜토리얼 배경)
  useEffect(() => {
    if (stage !== 'practice') return
    speak('연습을 시작할게요! 구령을 잘 듣고 따라해 보세요!', false, () => undefined)
    const runner = new GameRunner({
      commands: PRACTICE,
      scored: false,
      onSnapshot: setSnap,
      onFinish: () => {
        setSnap(null)
        setStage('countdown')
      },
    })
    runnerRef.current = runner
    const t = window.setTimeout(() => runner.start(), 3600)
    return () => {
      window.clearTimeout(t)
      runner.stop()
    }
  }, [stage])

  // 카운트다운 3-2-1-Start
  useEffect(() => {
    if (stage !== 'countdown') return
    speak('이제 진짜 시작이에요!', false, () => undefined)
    let i = -1
    const iv = window.setInterval(() => {
      i += 1
      if (i < COUNT_IMGS.length) {
        setCountIdx(i)
        beep(i === COUNT_IMGS.length - 1 ? 1320 : 880, 150)
      } else {
        window.clearInterval(iv)
        setCountIdx(-1)
        setStage('main')
      }
    }, 1000)
    return () => window.clearInterval(iv)
  }, [stage])

  // 본 게임 (2라운드 × 10구령)
  useEffect(() => {
    if (stage !== 'main') return
    const runner = new GameRunner({
      commands: COMMANDS,
      scored: true,
      roleSwapAfter: ROUND_SIZE - 1,
      onSnapshot: setSnap,
      onFinish: (logs, score) => {
        setStage('end')
        window.setTimeout(() => finishRef.current(logs, score), 2600)
      },
    })
    runnerRef.current = runner
    runner.start()
    return () => runner.stop()
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

      {/* 카메라 (중앙 하단, ON/OFF 토글 가능) */}
      <CameraPanel style={{ left: 629, top: 708, width: 661, height: 372 }} />
    </div>
  )
}
