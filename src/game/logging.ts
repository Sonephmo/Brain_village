import type { CommandLog, SessionLog } from './types'
import { poseEngine } from './pose'
import { COMMANDS } from './commands'

/** 20구령을 모두 마쳤는지. 진행요원이 중단하면 기록이 모자란다. */
export function isCompleted(logs: CommandLog[]): boolean {
  return logs.length >= COMMANDS.length
}

export function buildSessionLog(
  logs: CommandLog[],
  score: number,
  avatars: { p1: 'grandma' | 'grandfa'; p2: 'grandma' | 'grandfa' },
): SessionLog {
  return {
    게임: '오락가락 청기백기',
    버전: 'demo-2.6',
    시작시각: new Date().toISOString(),
    아바타: {
      P1: avatars.p1 === 'grandma' ? '할머니' : '할아버지',
      P2: avatars.p2 === 'grandma' ? '할머니' : '할아버지',
    },
    라운드역할: {
      R1: { P1: '청기', P2: '백기' },
      R2: { P1: '백기', P2: '청기' },
    },
    입력모드: poseEngine.keyboardMode && !poseEngine.cameraOk ? '키보드' : '포즈인식',
    완주: isCompleted(logs),
    진행구령수: logs.length,
    구령기록: logs,
    팀점수: score,
    만점: 100,
  }
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
