import { poseEngine } from './pose'
import { useEffect, useRef, useState } from 'react'
import { GameClock } from './gameClock'
import { pauseGameAudio, resumeGameAudio } from './audio'
import { setBgmPaused } from './bgm'

/** One clock per mounted game. Visibility never resumes a game without a deliberate action. */
export function useGamePause(enabled: boolean) {
  const [clock] = useState(() => new GameClock())
  const [paused, setPaused] = useState(false)
  const version = useRef(0)
  const pause = () => {
    if (!enabled) return
    version.current++
    poseEngine.setKeyboardPaused(true)
    clock.pause()
    pauseGameAudio()
    setBgmPaused(true)
    setPaused(true)
  }
  const resume = async () => {
    if (!clock.paused || document.hidden) return
    const request = ++version.current
    await resumeGameAudio()
    if (request !== version.current) return
    setBgmPaused(false)
    poseEngine.setKeyboardPaused(false)
    clock.resume()
    setPaused(false)
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || !enabled) return
      event.preventDefault()
      if (clock.paused) void resume()
      else pause()
    }
    window.addEventListener('blur', pause)
    window.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', hidden)
    hidden()
    return () => {
      window.removeEventListener('blur', pause)
      window.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [enabled, clock])
  useEffect(() => () => {
    version.current++
    poseEngine.setKeyboardPaused(false)
    clock.dispose()
    void resumeGameAudio()
    setBgmPaused(false)
  }, [clock])
  return { clock, paused, pause, resume }
}
