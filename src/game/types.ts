export type PlayerId = 1 | 2
export type Hand = 'left' | 'right'
export type ExpectedAction = 'none' | 'both' | 'left' | 'right'
export type Level = 'L1' | 'L2' | 'L3' | 'L4'
export type ErrorType = '누락' | '오작동' | '오손' | '부분수행' | '조급반응' | null

export interface Command {
  id: number
  level: Level
  /** 이어붙일 녹음 단어. 화면 텍스트도 이 배열에서 만들어 음성과 항상 일치시킨다. */
  words: import('./audio').ClipId[]
  text: string // 화면 표시 문장
  isFake: boolean // L3 물음표 페이크
  expect: { p1: ExpectedAction; p2: ExpectedAction } // 역할 기준이 아니라 "청기측/백기측"이 아닌, 라운드 반영된 플레이어 기준
  guide: string // 보조 설명 텍스트
}

export interface PlayerJudge {
  correct: boolean
  errorType: ErrorType
  reactionMs: number | null // 발화 종료 → 임계선 통과. 정답 반응에서만 기록
}

export interface CommandLog {
  구령ID: number
  레벨: Level
  구령: string
  기대동작: { P1: ExpectedAction; P2: ExpectedAction }
  판정: {
    P1: { 정답: boolean; 오류유형: ErrorType; 반응속도ms: number | null }
    P2: { 정답: boolean; 오류유형: ErrorType; 반응속도ms: number | null }
  }
  획득점수: number
  발화길이ms: number
}

export interface SessionLog {
  게임: string
  버전: string
  시작시각: string
  아바타: { P1: string; P2: string }
  라운드역할: { R1: { P1: string; P2: string }; R2: { P1: string; P2: string } }
  입력모드: '포즈인식' | '키보드'
  /** 20구령을 모두 마쳤는지. false면 진행요원이 중단한 세션이다. */
  완주: boolean
  진행구령수: number
  구령기록: CommandLog[]
  팀점수: number
  만점: number
}

// 포즈 엔진이 프레임마다 갱신하는 플레이어 상태
export interface PlayerPose {
  present: boolean
  noseX: number | null // 반쪽 프레임 내 정규화 좌표 (0~1, 원본 기준)
  noseY: number | null
  /** 거울 모드를 반영한 화면상 가로 위치 (= 1 - noseX). 화면 요소와 대조할 때 쓴다. */
  screenX: number | null
  leftRaised: boolean // 사용자 신체 기준 왼손이 임계선 위
  rightRaised: boolean
  leftWristY: number | null
  rightWristY: number | null
  shoulderY: number | null
}
