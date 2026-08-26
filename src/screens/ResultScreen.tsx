import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { IMG, RESULT, prizeFor, type Frame } from '../assets'
import { Sprite } from '../components/Sprite'
import type { CommandLog } from '../game/types'
import { buildSessionLog, downloadJson, isCompleted } from '../game/logging'
import { playBgm, stopBgm } from '../game/bgm'
import { COMMANDS } from '../game/commands'
import type { AvatarPick } from './TutorialScreen'

// 결과 화면 — 피그마 Result(121:497) 좌표 그대로.
// 팀 통합 점수 1개만 노출하고 개인 점수는 보여주지 않는다(스펙 §4.2·§4.3).
//
// 좌표는 모두 1920x1080 스테이지 기준 절대값이다.
const LAYOUT = {
  banner: { left: 710, top: 22, width: 500, height: 137 },
  scorePanel: { left: 645, top: 159, width: 648, height: 280 },
  scoreText: { left: 645, top: 256, width: 670, height: 153 },
  feedbackPanel: { left: 271, top: 439, width: 811, height: 421 },
  feedbackText: { left: 395, top: 573, width: 564, height: 239 },
  prize: { left: 1180, top: 409, width: 455, height: 451 },
  btnRetry: { left: 119, top: 887, width: 526, height: 166 },
  btnYes: { left: 698, top: 887, width: 524, height: 166 },
  btnHome: { left: 1275, top: 887, width: 526, height: 166 },
} as const

// NeoDunggeunmo는 한글 1글자 = 1em, 아스키 = 0.5em 폭이다.
// 피드백 문구가 길어져도 상자를 넘지 않도록 글자 크기를 줄인다.
function fitFont(text: string, boxW: number, max: number): number {
  const units = [...text].reduce((s, ch) => s + (ch.charCodeAt(0) < 128 ? 0.5 : 1), 0)
  return Math.min(max, Math.floor(boxW / Math.max(units, 1)))
}

export function ResultScreen({
  logs,
  score,
  avatars,
  onReplay,
  onRestart,
  onTitle,
}: {
  logs: CommandLog[]
  score: number
  avatars: { p1: AvatarPick; p2: AvatarPick }
  /** 다시하기: 같은 팀이 이 게임을 바로 한 번 더 (튜토리얼·캘리브레이션 생략) */
  onReplay: () => void
  /** 확인: 마을로 돌아가 다른 장소 고르기 */
  onRestart: () => void
  /** 홈으로: 타이틀로 완전 리셋 (다음 팀) */
  onTitle: () => void
}) {
  const session = useMemo(() => buildSessionLog(logs, score, avatars), [logs, score, avatars])
  // 진행요원이 중단한 세션은 20구령을 다 하지 않았으므로 '완주'라고 말하지 않는다
  const completed = isCompleted(logs)
  const bothCorrect = logs.filter(l => l.판정.P1.정답 && l.판정.P2.정답).length
  const prize = prizeFor(score)

  const phrase = !completed
    ? '여기까지!'
    : score >= 90
      ? '최고예요!'
      : score >= 80
        ? '아주 잘했어요!'
        : score >= 60
          ? '잘했어요!'
          : score >= 40
            ? '좋았어요!'
            : '수고했어요!'
  const stat = completed
    ? `${bothCorrect}/${COMMANDS.length}구령 성공`
    : `${logs.length}구령까지 진행`

  // 결과 BGM은 진입과 동시에 정상 볼륨으로 재생한다.
  useEffect(() => {
    playBgm('report')
    return () => stopBgm()
  }, [])

  return (
    <div className="fill fade-in">
      {/* 배경은 인게임과 같은 운동장 사진에 블러만 걸린다 (디자인 BG 노드: blur 5.55px) */}
      <img src={IMG.gameBg} alt="" className="fill" style={{ objectFit: 'cover', filter: 'blur(5.55px)' }} />

      <Sprite frame={RESULT.banner} style={{ ...LAYOUT.banner }} />
      <Sprite frame={RESULT.scorePanel} style={{ ...LAYOUT.scorePanel }} />

      {/* 총점 — 위(#FBF620)에서 아래(#FAA404)로 흐르는 그라디언트에 검은 외곽선.
          그라디언트는 background-clip:text로 채우고, 외곽선은 뒤에 한 겹 더 깔아 낸다
          (한 요소에 text-stroke와 background-clip을 같이 주면 선이 채움을 파먹는다). */}
      <div className="pop" style={{ position: 'absolute', ...LAYOUT.scoreText }}>
        <p className="pixel-text" style={{ ...SCORE_TEXT, ...SCORE_OUTLINE }}>
          {score}
        </p>
        <p className="pixel-text" style={{ ...SCORE_TEXT, ...SCORE_FILL }}>
          {score}
        </p>
      </div>

      <Sprite frame={RESULT.feedbackPanel} style={{ ...LAYOUT.feedbackPanel }} />
      <div
        style={{
          position: 'absolute',
          ...LAYOUT.feedbackText,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
        }}
      >
        <p
          className="pixel-text"
          style={{
            fontSize: fitFont(phrase, LAYOUT.feedbackText.width, 100),
            lineHeight: 1,
            color: '#000',
            whiteSpace: 'nowrap',
          }}
        >
          {phrase}
        </p>
        <p
          className="pixel-text"
          style={{ fontSize: 40, lineHeight: 1, color: '#4a3a1c', whiteSpace: 'nowrap' }}
        >
          {stat}
        </p>
      </div>

      {/* 점수 구간 상품. 리본에 상품명이 그려져 있어 별도 글자를 얹지 않는다. */}
      <Sprite key={prize.name} frame={prize.frame} className="pop" style={{ ...LAYOUT.prize }} />

      <ResultButton frame={RESULT.btnRetry} box={LAYOUT.btnRetry} label="다시하기" onClick={onReplay} />
      <ResultButton frame={RESULT.btnYes} box={LAYOUT.btnYes} label="확인" onClick={onRestart} />
      <ResultButton frame={RESULT.btnHome} box={LAYOUT.btnHome} label="홈으로" onClick={onTitle} />

      {/* 진행요원용. 참가자 시선에서 벗어난 위치에 반투명으로 둔다. */}
      <button
        className="pixel-btn secondary"
        style={{ position: 'absolute', right: 20, top: 20, fontSize: 26, opacity: 0.3 }}
        onClick={() => downloadJson(session, `brainvillage_${Date.now()}.json`)}
      >
        결과 JSON
      </button>
    </div>
  )
}

const SCORE_TEXT: CSSProperties = {
  position: 'absolute',
  inset: 0,
  fontSize: 150,
  lineHeight: '153px',
  textAlign: 'center',
}
// 피그마 텍스트 스트로크 3px은 글자 윤곽 중앙에 걸리므로 바깥으로 3px 보이려면 6px이 필요하다
const SCORE_OUTLINE: CSSProperties = {
  color: 'transparent',
  WebkitTextStroke: '6px #000',
  textShadow: '0 4px 4px #000',
}
const SCORE_FILL: CSSProperties = {
  color: 'transparent',
  backgroundImage: 'linear-gradient(360deg, #FAA404 1.96%, #FBF620 86.93%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
}

/**
 * 결과 화면 버튼. 그림만 있는 버튼이라 호버 연출을 직접 넣는다.
 * CSS :hover가 아니라 **상태**로 켠다 — 손 제스처 커서가 보내는 합성 이벤트로는
 * CSS :hover가 발동하지 않기 때문이다(마을 스포트라이트와 같은 이유).
 */
function ResultButton({
  frame,
  box,
  label,
  onClick,
}: {
  frame: Frame
  box: { left: number; top: number; width: number; height: number }
  label: string
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      role="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        position: 'absolute',
        ...box,
        transform: hover ? 'scale(1.05)' : 'scale(1)',
        transformOrigin: 'center center',
        transition: 'transform 0.14s ease-out, filter 0.14s ease-out',
        filter: hover ? 'brightness(1.12) drop-shadow(0 0 18px rgba(255,255,255,0.6))' : 'none',
      }}
    >
      <Sprite frame={frame} style={{ inset: 0 }} />
    </div>
  )
}
