// 구령 음성: 정식 녹음 파일 수령 전까지 Web Speech API(TTS)로 대체.
// 반응 창은 "발화 종료 시점"에 열리므로, TTS의 end 이벤트를 그대로 사용한다.
// TTS 불가 환경에서는 고정 1.5초 표시 후 비프음으로 종료를 알린다.

let ctx: AudioContext | null = null
function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function beep(freq = 880, durMs = 120, gainV = 0.15) {
  try {
    const ac = audioCtx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    gain.gain.value = gainV
    osc.connect(gain).connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + durMs / 1000)
  } catch {
    /* 오디오 불가 환경 무시 */
  }
}

export function goodChime() {
  beep(784, 90)
  setTimeout(() => beep(1046, 140), 100)
}

export function greatChime() {
  beep(784, 80)
  setTimeout(() => beep(988, 80), 90)
  setTimeout(() => beep(1319, 180), 180)
}

export function neutralTick() {
  beep(520, 80, 0.08)
}

let koVoice: SpeechSynthesisVoice | null = null
function pickKoVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  koVoice = voices.find(v => v.lang.startsWith('ko')) ?? null
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  pickKoVoice()
  window.speechSynthesis.onvoiceschanged = pickKoVoice
}

/** 문장을 발화하고, 발화가 실제로 끝난 시점에 onEnd(발화길이 ms)를 호출한다. */
export function speak(text: string, isQuestion: boolean, onEnd: (spokenMs: number) => void) {
  const fallback = () => {
    const ms = Math.max(1200, text.length * 130)
    window.setTimeout(() => {
      beep(isQuestion ? 660 : 880, 150)
      onEnd(ms)
    }, ms)
  }

  if (!('speechSynthesis' in window)) {
    fallback()
    return
  }

  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    if (koVoice) u.voice = koVoice
    u.rate = 0.92
    u.pitch = isQuestion ? 1.25 : 1.0
    const start = performance.now()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onEnd(performance.now() - start)
    }
    u.onend = finish
    u.onerror = finish
    // 일부 브라우저에서 onend 미발화 대비 안전 타임아웃
    window.setTimeout(finish, Math.max(3500, text.length * 350))
    window.speechSynthesis.speak(u)
  } catch {
    fallback()
  }
}

export function stopSpeech() {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* noop */
  }
}
