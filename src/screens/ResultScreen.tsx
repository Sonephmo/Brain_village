import { useMemo } from 'react'
import { FX, IMG, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import type { CommandLog } from '../game/types'
import { buildSessionLog, downloadJson } from '../game/logging'
import { speak } from '../game/audio'
import { useEffect } from 'react'
import type { AvatarPick } from './TutorialScreen'

// 결과: 팀 통합 점수 1개만 노출(개인 점수 비노출), JSON 다운로드 제공 — 스펙 §4.2·§4.3
export function ResultScreen({
  logs,
  score,
  avatars,
  onRestart,
}: {
  logs: CommandLog[]
  score: number
  avatars: { p1: AvatarPick; p2: AvatarPick }
  onRestart: () => void
}) {
  const session = useMemo(() => buildSessionLog(logs, score, avatars), [logs, score, avatars])
  const beat = score >= 90 // 마을 오버레이 내러티브: 1등팀 89점

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
        {beat ? '1등팀(89점)을 넘었어요! 제주도 여행 당첨!' : '두 분이 힘을 모아 완주했어요!'}
      </p>
      <div
        role="button"
        onClick={onRestart}
        style={{
          position: 'absolute',
          left: '50%',
          top: 806,
          transform: 'translateX(-50%)',
          ...frameSize(FX.btnRetry, { w: 520 }),
        }}
      >
        <Sprite frame={FX.btnRetry} style={{ inset: 0 }} />
      </div>
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
