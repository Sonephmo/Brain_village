import { useEffect, useRef, useState } from 'react'
import { EFFECT, IMG } from '../assets'
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
  const showEffects = snap?.phase === 'feedback' && judged
  const nCorrect = judged ? (judged.p1.correct ? 1 : 0) + (judged.p2.correct ? 1 : 0) : 0

  return (
    <div className="fill fade-in">
      <img src={bg} alt="" className="fill" style={{ objectFit: 'cover', filter: stage === 'countdown' ? 'blur(5px)' : 'none' }} />
      <div className="divider-line" style={{ top: 212 }} />

      {/* 아바타 (디자인 A Game play 좌표) */}
      <Avatar avatar={avatars.p1} flag={flags.p1} pose={poseOf('p1')} face={faceOf('p1')} size={499} style={{ left: 130, top: 343 }} />
      <Avatar avatar={avatars.p2} flag={flags.p2} pose={poseOf('p2')} face={faceOf('p2')} size={499} style={{ left: 1290, top: 343 }} />

      {/* 구령 텍스트 */}
      {cmd && (snap?.phase === 'speak' || snap?.phase === 'window' || snap?.phase === 'feedback') && (
        <>
          <p
            className="pixel-text"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 96,
              fontSize: 130,
              textAlign: 'center',
              color: '#fff',
              textShadow: '0 6px 0 rgba(0,0,0,0.55)',
            }}
          >
            {cmd.text}
            {cmd.isFake && <span style={{ color: '#ffb43a', fontSize: 170 }}> ?</span>}
          </p>
          {/* 페이크 구령: 억양 외 시각 구분 (스펙 §6 접근성) */}
          {cmd.isFake && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 86,
                transform: 'translateX(-50%)',
                width: 1100,
                height: 210,
                border: '10px dashed #ffb43a',
                borderRadius: 20,
                pointerEvents: 'none',
              }}
            />
          )}
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 268, fontSize: 48, textAlign: 'center', color: '#fff', textShadow: '0 3px 0 rgba(0,0,0,0.5)' }}>
            {cmd.guide}
          </p>
        </>
      )}

      {/* 반응 창 타이머 (노란 픽셀 숫자, 100ms 단위) */}
      {snap?.phase === 'window' && (
        <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 0, fontSize: 96, textAlign: 'center', color: '#ffd83a', textShadow: '0 4px 0 rgba(0,0,0,0.6)' }}>
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
        <p className="pixel-text" style={{ position: 'absolute', right: 40, top: 20, fontSize: 44, color: '#ffd83a', textShadow: '0 3px 0 rgba(0,0,0,0.6)' }}>
          연습 {Math.min(cmdIndex + 1, PRACTICE.length)} / {PRACTICE.length}
        </p>
      )}

      {/* 피드백 이펙트: 정답자 아래 Good, 둘 다 정답이면 중앙 Great. 오답은 표정으로만 (스펙 §6) */}
      {showEffects && judged && (
        <>
          {judged.p1.correct && <Sprite crop={EFFECT.good.crop} className="pop" style={{ left: 210, top: 733, width: 627, height: 347 }} />}
          {judged.p2.correct && <Sprite crop={EFFECT.good.crop} className="pop" style={{ left: 1163, top: 733, width: 627, height: 347 }} />}
          {nCorrect === 2 && (
            <Sprite crop={EFFECT.great.crop} className="pop" style={{ left: '50%', top: 380, width: 700, height: 326, transform: 'translateX(-50%)' }} />
          )}
        </>
      )}

      {/* 역할 교체 안내 */}
      {snap?.phase === 'roleswap' && (
        <div className="fill fade-in" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 30 }}>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 200, fontSize: 110, textAlign: 'center', color: '#fff' }}>
            역할을 바꿔요!
          </p>
          <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 360, fontSize: 60, textAlign: 'center', color: '#ffd83a' }}>
            이제 1P는 백기, 2P는 청기입니다
          </p>
          <Avatar avatar={avatars.p1} flag="white" pose="up" face="good" size={420} style={{ left: 320, top: 460 }} />
          <Avatar avatar={avatars.p2} flag="blue" pose="up" face="good" size={420} style={{ left: 1180, top: 460 }} />
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
