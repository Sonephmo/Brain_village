/** Shared Figma Text_Timer styling; each game keeps its own countdown value. */
export function GameTimer({ value }: { value: string | number }) {
  return <p className="game-timer" role="timer" aria-label={`남은 시간 ${value}초`}>
    <span className="game-timer-outline" aria-hidden="true">{value}</span>
    <span className="game-timer-fill" aria-hidden="true">{value}</span>
  </p>
}
