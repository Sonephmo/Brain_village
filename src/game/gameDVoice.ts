import type { ShoppingEvent } from './gameD'

/** Same sentences as the unedited Garam recordings; also shown while guidance plays. */
export const SHOPPING_VOICE_TEXT = {
  d_rules: '두 사람이 함께, 이 분 안에 목록의 물건을 담아 주세요. 물건이 초록 칸에 오면 양손을 쥐어 주세요.',
  d_practice: '양팔을 앞으로 뻗고 손을 활짝 펴 주세요. 양손을 함께 쥐었다 펴는 동작을 두 번 연습해 볼까요?',
  d_start: '잘하셨어요. 이제 장보기를 시작해 볼까요?',
  d_correct: '잘 담았어요!',
  d_empty: '물건이 초록 칸에 오면 담아 주세요.',
  d_wrong: '목록에 없는 물건이에요. 목록을 다시 확인해 주세요.',
  d_complete: '이 물건은 이미 다 담았어요.',
  d_success: '잘하셨어요! 목록의 물건을 모두 담았어요.',
  d_timeout: '장보기 시간이 끝났어요. 수고하셨어요.',
  d_resume: '양팔을 앞으로 뻗고 양손을 활짝 펴 주세요. 다시 시작할게요.',
} as const
export type ShoppingVoiceKey = keyof typeof SHOPPING_VOICE_TEXT

export function shoppingFeedbackVoice(event: ShoppingEvent): ShoppingVoiceKey {
  if (event.outcome === 'correct') return 'd_correct'
  if (event.outcome === 'empty') return 'd_empty'
  return event.reason === 'already-complete' ? 'd_complete' : 'd_wrong'
}
