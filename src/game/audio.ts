// 구령 음성: 녹음이 문장이 아니라 **단어 단위 7개**로 전달되어, 단어를 이어붙여 구령을 만든다.
//   01_청기 · 02_백기 · 03_들어 · 04_올리지_말고 · 05_양손 · 06_왼손 · 07_오른손
//
// 각 클립은 앞 ~70ms, 뒤 420~520ms의 무음을 포함한다. 그대로 이으면 단어 사이가 벌어지고
// 무엇보다 "반응 창은 발화 종료 시점에 열림"(스펙 §3.2) 규칙이 무음만큼 늦게 적용된다.
// 그래서 디코딩 직후 무음 구간을 잘라 실제 발화 길이를 구하고, GAP_MS만 넣어 재생한다.
//
// 녹음에 없는 것: "둘다"(→ 색 지정 없는 구령이 곧 두 사람 모두를 뜻함), 의문형 억양(L3 페이크).
// 페이크는 마지막 단어를 살짝 올려(detune) 재생하고, 화면의 물음표·테두리가 주 구분 수단이다(§6).

export type ClipId = '청기' | '백기' | '들어' | '올리지말고' | '양손' | '왼손' | '오른손'

const CLIP_FILE: Record<ClipId, string> = {
  청기: '01_청기',
  백기: '02_백기',
  들어: '03_들어',
  올리지말고: '04_올리지_말고',
  양손: '05_양손',
  왼손: '06_왼손',
  오른손: '07_오른손',
}

const GAP_MS = 80 // 단어 사이 간격
const SILENCE_TH = 0.01
const FAKE_DETUNE_CENTS = 220 // 의문형 느낌을 주는 마지막 단어 피치 상승
const TARGET_PEAK = 0.85 // 클립별 음량 정규화 목표
const MIN_SILENCE_S = 0.15 // 이보다 긴 무음은 비정상 공백으로 보고 잘라 붙인다
const INTRA_GAP_MS = 60 // 한 단어 안에서 음절을 이을 때의 자연스러운 폐쇄 구간

interface Seg {
  start: number
  dur: number
}
interface ClipPlan {
  segs: Seg[]
  gain: number
  /** 재생에 걸리는 총 시간(초) = 세그먼트 합 + 내부 간격 */
  total: number
}

let ctx: AudioContext | null = null
const buffers = new Map<ClipId, AudioBuffer>()
const plans = new Map<ClipId, ClipPlan>()
let loadPromise: Promise<void> | null = null

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 사용자 제스처(시작 버튼 클릭) 시점에 호출해 오디오를 해금하고 클립을 미리 받아둔다. */
export function initAudio(): Promise<void> {
  if (loadPromise) return loadPromise
  const ac = audioCtx()
  loadPromise = (async () => {
    await Promise.all(
      (Object.keys(CLIP_FILE) as ClipId[]).map(async id => {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}assets/Sound/${encodeURIComponent(CLIP_FILE[id])}.mp3`)
          if (!res.ok) return
          const buf = await ac.decodeAudioData(await res.arrayBuffer())
          buffers.set(id, buf)
          plans.set(id, analyzeClip(buf))
        } catch {
          /* 개별 클립 실패는 무시하고 TTS로 대체된다 */
        }
      }),
    )
  })()
  return loadPromise
}

/**
 * 클립을 분석해 재생 구간과 음량 보정을 구한다.
 *
 * 전달받은 녹음에 두 가지 편차가 있어 보정이 필요하다.
 *  - `02_백기`는 「백」과 「기」 사이에 240ms의 공백이 있다(청기는 40ms).
 *    → 음절은 모두 살리고 그 공백만 INTRA_GAP_MS로 압축해 붙인다.
 *  - 클립 간 최대 진폭이 0.275(오른손)~0.901(양손)로 3.3배(약 10dB) 차이난다
 *    → 클립별 게인으로 맞춘다. 부스 소음 환경에서 특정 단어만 안 들리는 것을 막는다.
 */
function analyzeClip(buf: AudioBuffer): ClipPlan {
  const d = buf.getChannelData(0)
  const sr = buf.sampleRate
  const minSil = Math.round(MIN_SILENCE_S * sr)

  // 무음으로 구분되는 발화 덩어리 추출
  const segs: Array<[number, number]> = []
  let inSeg = false
  let segStart = 0
  let sil = 0
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > SILENCE_TH) {
      if (!inSeg) {
        inSeg = true
        segStart = i
      }
      sil = 0
    } else if (inSeg) {
      sil++
      if (sil > minSil) {
        segs.push([segStart, i - sil])
        inSeg = false
      }
    }
  }
  if (inSeg) segs.push([segStart, d.length - 1])
  if (segs.length === 0) return { segs: [{ start: 0, dur: buf.duration }], gain: 1, total: buf.duration }

  // 음절이 잘리지 않도록 앞뒤 15ms 여유를 두고 각 덩어리를 구간으로 만든다
  const pad = 0.015
  const out: Seg[] = segs.map(([a, b]) => {
    const start = Math.max(0, a / sr - pad)
    const end = Math.min(buf.duration, b / sr + pad)
    return { start, dur: end - start }
  })

  let peak = 0
  for (const s of out) {
    for (let i = Math.round(s.start * sr); i < Math.round((s.start + s.dur) * sr); i++) {
      const a = Math.abs(d[i])
      if (a > peak) peak = a
    }
  }
  const gain = peak > 0.01 ? Math.min(4, Math.max(0.5, TARGET_PEAK / peak)) : 1
  const total = out.reduce((a, s) => a + s.dur, 0) + (INTRA_GAP_MS / 1000) * (out.length - 1)
  return { segs: out, gain, total }
}

export function clipsReady(words: ClipId[]): boolean {
  return words.length > 0 && words.every(w => buffers.has(w))
}

/** 단어 배열의 예상 발화 길이(ms). 시퀀스 고정이므로 사전 계산에 쓸 수 있다. */
export function estimateDurationMs(words: ClipId[]): number | null {
  if (!clipsReady(words)) return null
  const speech = words.reduce((a, w) => a + plans.get(w)!.total * 1000, 0)
  return Math.round(speech + GAP_MS * (words.length - 1))
}

let activeSources: AudioBufferSourceNode[] = []
let activeTimer = 0

function stopClips() {
  activeSources.forEach(s => {
    try {
      s.stop()
    } catch {
      /* 이미 정지 */
    }
  })
  activeSources = []
  window.clearTimeout(activeTimer)
}

/**
 * 구령을 재생하고, **실제 발화가 끝나는 시점**에 onEnd(발화길이 ms)를 호출한다.
 * 클립이 없으면 TTS로 대체한다(개발 중 또는 로드 실패 시).
 */
export function speakCommand(
  words: ClipId[],
  text: string,
  isFake: boolean,
  onEnd: (spokenMs: number) => void,
) {
  stopClips()
  if (!clipsReady(words)) {
    speak(text, isFake, onEnd)
    return
  }
  const ac = audioCtx()
  const startAt = ac.currentTime + 0.06 // 스케줄링 여유
  let cursor = startAt
  words.forEach((w, i) => {
    const buf = buffers.get(w)!
    const plan = plans.get(w)!
    const lastWord = i === words.length - 1
    plan.segs.forEach((seg, si) => {
      const src = ac.createBufferSource()
      src.buffer = buf
      if (isFake && lastWord) {
        try {
          src.detune.value = FAKE_DETUNE_CENTS
        } catch {
          /* detune 미지원 브라우저는 원음 그대로 */
        }
      }
      const g = ac.createGain()
      g.gain.value = plan.gain // 클립 간 음량 편차 보정
      src.connect(g).connect(ac.destination)
      src.start(cursor, seg.start, seg.dur)
      activeSources.push(src)
      cursor += seg.dur
      if (si < plan.segs.length - 1) cursor += INTRA_GAP_MS / 1000
    })
    if (!lastWord) cursor += GAP_MS / 1000
  })
  const t0 = performance.now()
  // 발화 종료 시점에 맞춰 콜백. AudioContext 시계 기준으로 남은 시간을 계산한다.
  activeTimer = window.setTimeout(
    () => onEnd(performance.now() - t0),
    Math.max(0, (cursor - ac.currentTime) * 1000),
  )
}

// ─── 안내 멘트: 녹음이 없어 TTS 사용 ───

let koVoice: SpeechSynthesisVoice | null = null
function pickKoVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  koVoice = voices.find(v => v.lang.startsWith('ko')) ?? null
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  pickKoVoice()
  window.speechSynthesis.onvoiceschanged = pickKoVoice
}

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
    window.setTimeout(finish, Math.max(3500, text.length * 350))
    window.speechSynthesis.speak(u)
  } catch {
    fallback()
  }
}

export function stopSpeech() {
  stopClips()
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* noop */
  }
}

// ─── 효과음 ───

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
