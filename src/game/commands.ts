import type { Command } from './types'

// 확정 구령 시퀀스 (demo-spec v1.1)
// 동사는 디자인 확정안 "올려" 채택. 시퀀스/레벨/기대동작은 스펙 §3.4 그대로.
// 1라운드: 1P=청기, 2P=백기 / 2라운드: 역할 교체(1P=백기, 2P=청기)

export const ROUND_SIZE = 10

export const COMMANDS: Command[] = [
  // ─── 1라운드 (1P=청, 2P=백) ───
  { id: 1, level: 'L1', text: '청기 올려!', isFake: false, expect: { p1: 'both', p2: 'none' }, guide: '청기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 2, level: 'L1', text: '백기 올려!', isFake: false, expect: { p1: 'none', p2: 'both' }, guide: '백기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 3, level: 'L1', text: '백기 올려!', isFake: false, expect: { p1: 'none', p2: 'both' }, guide: '백기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 4, level: 'L1', text: '청기 올려!', isFake: false, expect: { p1: 'both', p2: 'none' }, guide: '청기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 5, level: 'L1', text: '둘다 올려!', isFake: false, expect: { p1: 'both', p2: 'both' }, guide: '두 사람 모두 양손을 위로 들어주세요!' },
  { id: 6, level: 'L2', text: '청기 왼손 올려!', isFake: false, expect: { p1: 'left', p2: 'none' }, guide: '청기를 든 사람만 왼손을 올려주세요!' },
  { id: 7, level: 'L2', text: '백기 오른손 올려!', isFake: false, expect: { p1: 'none', p2: 'right' }, guide: '백기를 든 사람만 오른손을 올려주세요!' },
  { id: 8, level: 'L3', text: '청기 올려?', isFake: true, expect: { p1: 'none', p2: 'none' }, guide: '물음표! 움직이면 안 돼요!' },
  { id: 9, level: 'L2', text: '둘다 왼손 올려!', isFake: false, expect: { p1: 'left', p2: 'left' }, guide: '두 사람 모두 왼손을 올려주세요!' },
  { id: 10, level: 'L3', text: '백기 오른손 올려?', isFake: true, expect: { p1: 'none', p2: 'none' }, guide: '물음표! 움직이면 안 돼요!' },
  // ─── 2라운드 (1P=백, 2P=청) ───
  { id: 11, level: 'L1', text: '백기 올려!', isFake: false, expect: { p1: 'both', p2: 'none' }, guide: '백기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 12, level: 'L1', text: '청기 올려!', isFake: false, expect: { p1: 'none', p2: 'both' }, guide: '청기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 13, level: 'L2', text: '둘다 오른손 올려!', isFake: false, expect: { p1: 'right', p2: 'right' }, guide: '두 사람 모두 오른손을 올려주세요!' },
  { id: 14, level: 'L2', text: '청기 왼손 올려!', isFake: false, expect: { p1: 'none', p2: 'left' }, guide: '청기를 든 사람만 왼손을 올려주세요!' },
  { id: 15, level: 'L2', text: '백기 오른손 올려!', isFake: false, expect: { p1: 'right', p2: 'none' }, guide: '백기를 든 사람만 오른손을 올려주세요!' },
  { id: 16, level: 'L3', text: '둘다 올려?', isFake: true, expect: { p1: 'none', p2: 'none' }, guide: '물음표! 움직이면 안 돼요!' },
  { id: 17, level: 'L3', text: '백기 왼손 올려?', isFake: true, expect: { p1: 'none', p2: 'none' }, guide: '물음표! 움직이면 안 돼요!' },
  { id: 18, level: 'L4', text: '청기 올리지 말고 백기 올려!', isFake: false, expect: { p1: 'both', p2: 'none' }, guide: '백기를 든 사람이 양손을 올려주세요!' },
  { id: 19, level: 'L4', text: '백기 올리지 말고 청기 왼손 올려!', isFake: false, expect: { p1: 'none', p2: 'left' }, guide: '청기를 든 사람만 왼손을 올려주세요!' },
  { id: 20, level: 'L4', text: '왼손 올리지 말고 둘다 오른손 올려!', isFake: false, expect: { p1: 'right', p2: 'right' }, guide: '두 사람 모두 오른손만 올려주세요!' },
]

// 튜토리얼 무채점 연습 5구령 (디자인 tut_play1~5 기준)
export const PRACTICE: Command[] = [
  { id: 101, level: 'L1', text: '청기 올려!', isFake: false, expect: { p1: 'both', p2: 'none' }, guide: '청기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 102, level: 'L1', text: '백기 올려!', isFake: false, expect: { p1: 'none', p2: 'both' }, guide: '백기를 들고있는 사람이 양손을 위로 들어주세요!' },
  { id: 103, level: 'L2', text: '둘다 왼손 올려!', isFake: false, expect: { p1: 'left', p2: 'left' }, guide: '두 사람 모두 왼손을 들어주세요!' },
  { id: 104, level: 'L2', text: '둘다 오른손 올려!', isFake: false, expect: { p1: 'right', p2: 'right' }, guide: '두 사람 모두 오른손을 들어주세요!' },
  { id: 105, level: 'L1', text: '둘다 올려!', isFake: false, expect: { p1: 'both', p2: 'both' }, guide: '두 사람 모두 양손을 들어주세요!' },
]

// 라운드별 역할: [1P 깃발색, 2P 깃발색]
export function flagsForCommand(index: number): { p1: 'blue' | 'white'; p2: 'blue' | 'white' } {
  return index < ROUND_SIZE ? { p1: 'blue', p2: 'white' } : { p1: 'white', p2: 'blue' }
}
