import type { ClipId, NarrationKey } from './audio'
import type { Command } from './types'

// 확정 구령 시퀀스 (demo-spec v1.2)
// 화면 텍스트는 **녹음된 단어와 정확히 일치**해야 한다(난청 참가자 대응, 스펙 §6).
// 녹음 어휘 7개: 청기 · 백기 · 들어 · 올리지_말고 · 양손 · 왼손 · 오른손
//   - 동사는 "들어" (스펙 v1.0 표기와 동일. 디자인 시안의 "올려"는 녹음과 불일치하여 폐기)
//   - "둘다" 녹음이 없다 → **색을 지정하지 않은 구령이 두 사람 모두**를 뜻한다.
//     (청기백기 놀이의 통상 규칙이고, 가이드 문장이 "두 사람 모두"로 보강한다)
// 시퀀스/레벨/기대동작 배분은 스펙 §3.4를 그대로 유지한다.

export const ROUND_SIZE = 10

const cmd = (
  id: number,
  level: Command['level'],
  words: ClipId[],
  isFake: boolean,
  p1: Command['expect']['p1'],
  p2: Command['expect']['p2'],
  guide: string,
): Command => ({
  id,
  level,
  words,
  // 텍스트는 단어를 그대로 이어 만든다 → 화면과 음성이 항상 일치한다
  text: words.map(w => (w === '올리지말고' ? '올리지 말고' : w)).join(' ') + (isFake ? '?' : '!'),
  isFake,
  expect: { p1, p2 },
  guide,
})

const G = {
  blueBoth: '청기를 들고있는 사람이 양손을 위로 들어주세요!',
  whiteBoth: '백기를 들고있는 사람이 양손을 위로 들어주세요!',
  allBoth: '두 사람 모두 양손을 들어주세요!',
  blueLeft: '청기를 든 사람만 왼손을 들어주세요!',
  blueRight: '청기를 든 사람만 오른손을 들어주세요!',
  whiteLeft: '백기를 든 사람만 왼손을 들어주세요!',
  whiteRight: '백기를 든 사람만 오른손을 들어주세요!',
  allLeft: '두 사람 모두 왼손을 들어주세요!',
  allRight: '두 사람 모두 오른손을 들어주세요!',
  fake: '물음표! 움직이면 안 돼요!',
}

export const COMMANDS: Command[] = [
  // ─── 1라운드 (1P=청기, 2P=백기) ───
  cmd(1, 'L1', ['청기', '들어'], false, 'both', 'none', G.blueBoth),
  cmd(2, 'L1', ['백기', '들어'], false, 'none', 'both', G.whiteBoth),
  cmd(3, 'L1', ['백기', '들어'], false, 'none', 'both', G.whiteBoth),
  cmd(4, 'L1', ['청기', '들어'], false, 'both', 'none', G.blueBoth),
  cmd(5, 'L1', ['양손', '들어'], false, 'both', 'both', G.allBoth),
  cmd(6, 'L2', ['청기', '왼손', '들어'], false, 'left', 'none', G.blueLeft),
  cmd(7, 'L2', ['백기', '오른손', '들어'], false, 'none', 'right', G.whiteRight),
  cmd(8, 'L3', ['청기', '들어'], true, 'none', 'none', G.fake),
  cmd(9, 'L2', ['왼손', '들어'], false, 'left', 'left', G.allLeft),
  cmd(10, 'L3', ['백기', '오른손', '들어'], true, 'none', 'none', G.fake),
  // ─── 2라운드 (역할 교체: 1P=백기, 2P=청기) ───
  cmd(11, 'L1', ['백기', '들어'], false, 'both', 'none', G.whiteBoth),
  cmd(12, 'L1', ['청기', '들어'], false, 'none', 'both', G.blueBoth),
  cmd(13, 'L2', ['오른손', '들어'], false, 'right', 'right', G.allRight),
  cmd(14, 'L2', ['청기', '왼손', '들어'], false, 'none', 'left', G.blueLeft),
  cmd(15, 'L2', ['백기', '오른손', '들어'], false, 'right', 'none', G.whiteRight),
  cmd(16, 'L3', ['양손', '들어'], true, 'none', 'none', G.fake),
  cmd(17, 'L3', ['백기', '왼손', '들어'], true, 'none', 'none', G.fake),
  cmd(18, 'L4', ['청기', '올리지말고', '백기', '들어'], false, 'both', 'none', G.whiteBoth),
  cmd(19, 'L4', ['백기', '올리지말고', '청기', '왼손', '들어'], false, 'none', 'left', G.blueLeft),
  cmd(20, 'L4', ['왼손', '올리지말고', '오른손', '들어'], false, 'right', 'right', G.allRight),
]

// 튜토리얼 무채점 연습 5구령 (디자인 tut_play1~5 기준)
export const PRACTICE: Command[] = [
  cmd(101, 'L1', ['청기', '들어'], false, 'both', 'none', G.blueBoth),
  cmd(102, 'L1', ['백기', '들어'], false, 'none', 'both', G.whiteBoth),
  cmd(103, 'L2', ['왼손', '들어'], false, 'left', 'left', G.allLeft),
  cmd(104, 'L2', ['오른손', '들어'], false, 'right', 'right', G.allRight),
  cmd(105, 'L1', ['양손', '들어'], false, 'both', 'both', G.allBoth),
]

/**
 * 연습 구령별 가이드 나레이션. 시간 제한이 없어 구령 뒤에 이어서 들려줄 수 있다.
 * 103(왼손)은 녹음이 "두 사람 모두 한손을 들어주세요"로 구령('왼손 들어')과
 * 어긋나 연결하지 않았다 — 화면 텍스트로만 안내한다.
 */
export const PRACTICE_NARRATION: Record<number, NarrationKey> = {
  101: 'guideBlue',
  102: 'guideWhite',
  104: 'guideRight',
  105: 'guideBoth',
}

/** 라운드별 역할: 1~10구령은 1P=청기, 11~20구령은 교체 */
export function flagsForCommand(index: number): { p1: 'blue' | 'white'; p2: 'blue' | 'white' } {
  return index < ROUND_SIZE ? { p1: 'blue', p2: 'white' } : { p1: 'white', p2: 'blue' }
}
