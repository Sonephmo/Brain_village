import { useMemo } from 'react'
import { FX, IMG, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import type { CommandLog } from '../game/types'
import { buildSessionLog, downloadJson, isCompleted } from '../game/logging'
import { speak } from '../game/audio'
import { useEffect } from 'react'
import type { AvatarPick } from './TutorialScreen'

// 결과: 팀 통합 점수 1개만 노출(개인 점수 비노출), JSON 다운로드 제공 — 스펙 §4.2·§4.3
export function ResultScreen({
  logs,
  score,
  avatars,
  onRestart,
  onTitle,
}: {
  logs: CommandLog[]
  score: number
  avatars: { p1: AvatarPick; p2: AvatarPick }
  /** 같은 팀이 한 번 더: 마을로 */
  onRestart: () => void
  /** 다음 팀 받기: 타이틀로 완전 리셋 */
  onTitle: () => void
}) {
  const session = useMemo(() => buildSessionLog(logs, score, avatars), [logs, score, avatars])
  // 진행요원이 중단한 세션은 20구령을 다 하지 않았으므로 '완주'라고 말하지 않는다
  const completed = isCompleted(logs)
  const beat = completed && score >= 90 // 마을 오버레이 내러티브: 1등팀 89점

  useEffect(() => {
    speak(
      beat
        ? `팀 점수 ${score}점! 1등입니다! 제주도로 떠나요!`
        : `팀 점수 ${score}점! 정말 잘하셨어요!`,
      false,
      () => undefined,
    )
  }, [beat, score])

  return (
    <div className="fill fade-in">
      <img src={IMG.gameBg} alt="" className="fill" style={{ objectFit: 'cover', filter: 'blur(4px) brightness(0.7)' }} />
      <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 120, fontSize: 90, textAlign: 'center', color: '#fff', textShadow: '0 4px 0 rgba(0,0,0,0.6)' }}>
        오락가락 청기백기
      </p>
      <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 300, fontSize: 70, textAlign: 'center', color: '#ffd83a' }}>
        우리 팀 점수
      </p>
      <p className="pixel-text pop" style={{ position: 'absolute', left: 0, right: 0, top: 400, fontSize: 220, textAlign: 'center', color: '#4dff7c', textShadow: '0 8px 0 rgba(0,0,0,0.6)' }}>
        {score}점
      </p>
      <p className="pixel-text" style={{ position: 'absolute', left: 0, right: 0, top: 700, fontSize: 56, textAlign: 'center', color: '#fff' }}>
        {beat
          ? '1등팀(89점)을 넘었어요! 제주도 여행 당첨!'
          : completed
            ? '두 분이 힘을 모아 완주했어요!'
            : `여기까지 하셨어요! (${logs.length}구령)`}
      </p>
      {/* 같은 팀이 한 번 더 → 마을 / 다음 팀 → 타이틀 리셋 */}
      <div
        role="button"
        aria-label="다시하기"
        onClick={onRestart}
        style={{
          position: 'absolute',
          left: '50%',
          top: 800,
          transform: 'translateX(-50%)',
          ...frameSize(FX.btnRetry, { w: 460 }),
        }}
      >
        <Sprite frame={FX.btnRetry} style={{ inset: 0 }} />
      </div>
      <button
        className="pixel-btn secondary"
        style={{ position: 'absolute', left: '50%', top: 962, transform: 'translateX(-50%)', fontSize: 34 }}
        onClick={onTitle}
      >
        처음으로 (다음 팀)
      </button>
      <button
        className="pixel-btn secondary"
        style={{ position: 'absolute', right: 40, bottom: 32, fontSize: 30 }}
        onClick={() => downloadJson(session, `brainvillage_${Date.now()}.json`)}
      >
        결과 JSON 다운로드
      </button>
    </div>
  )
}
