import { GameClock } from './gameClock'

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

const audioClock = new GameClock()
let audioPaused = false
let audioChange: Promise<void> = Promise.resolve()
let ctx: AudioContext | null = null
const syncAudioState = () => {
  audioChange = audioChange.catch(() => undefined).then(async () => {
    if (!ctx || ctx.state === 'closed') return
    if (audioPaused) await ctx.suspend()
    else await ctx.resume()
  }).catch(() => undefined)
  return audioChange
}
export function pauseGameAudio() {
  audioPaused = true
  audioClock.pause()
  void syncAudioState()
}
export async function resumeGameAudio() {
  audioPaused = false
  await syncAudioState()
  if (!audioPaused) audioClock.resume()
}
const buffers = new Map<ClipId, AudioBuffer>()
const plans = new Map<ClipId, ClipPlan>()
let countdownBuf: AudioBuffer | null = null

/**
 * CountDown.mp3 안의 소리 4개 시작 지점(ms). 실측값이다.
 * 3 · 2 · 1 · 시작 이미지를 이 시점에 맞춰야 소리와 숫자가 어긋나지 않는다.
 * (간격이 1000ms가 아니라 약 910ms다)
 */
export const COUNTDOWN_CUES = [0, 925, 1831, 2770]
export const COUNTDOWN_TOTAL_MS = 3162
let loadPromise: Promise<void> | null = null

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (!audioPaused && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return ctx
}

/** 사용자 제스처(시작 버튼 클릭) 시점에 호출해 오디오를 해금하고 클립을 미리 받아둔다. */
export function initAudio(): Promise<void> {
  const ac = audioCtx()
  if (loadPromise) return loadPromise
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
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}assets/Sound/CountDown.mp3`)
      if (res.ok) countdownBuf = await ac.decodeAudioData(await res.arrayBuffer())
    } catch {
      /* 카운트다운 음원 실패 시 비프음으로 대체된다 */
    }
    await Promise.all([loadNarrations(ac), loadSfx(ac)])
  })()
  return loadPromise
}

/** 카운트다운 음원을 한 번 재생한다. 음원이 없으면 false를 돌려 호출부가 비프음으로 대체한다. */
let countdownSource: AudioBufferSourceNode | null = null
export function stopCountdown() {
  countdownSource?.stop()
  countdownSource?.disconnect()
  countdownSource = null
}
export function playCountdown(): boolean {
  stopCountdown()
  if (!countdownBuf) return false
  const ac = audioCtx()
  const src = ac.createBufferSource()
  src.buffer = countdownBuf
  src.connect(ac.destination)
  countdownSource = src
  src.onended = () => { src.disconnect(); if (countdownSource === src) countdownSource = null }
  src.start()
  return true
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
  audioClock.clearTimeout(activeTimer)
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
    // 클립 로드 실패 시의 대체 경로. TTS는 몰입을 깨뜨려 쓰지 않고,
    // 화면의 구령 텍스트를 읽을 시간만 무음으로 확보한 뒤 반응 창을 연다.
    const ms = Math.max(1200, text.length * 130)
    activeTimer = audioClock.setTimeout(() => onEnd(ms), ms)
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
  const t0 = audioClock.now()
  // 발화 종료 시점에 맞춰 콜백. AudioContext 시계 기준으로 남은 시간을 계산한다.
  activeTimer = audioClock.setTimeout(
    () => onEnd(audioClock.now() - t0),
    Math.max(0, (cursor - ac.currentTime) * 1000),
  )
}

export function stopSpeech() {
  stopClips()
}

// ─── 효과음 (휘슬) ───
//
// 운동회 진행자 휘슬. 기존 합성 비프음을 대체한다.
// 마무리휘슬은 앞 481ms가 무음이라 그대로 재생하면 "끝!" 이미지보다 늦게 들린다 → 잘라낸다.
// 원본 음량이 낮아(0.199 / 0.451) 음성(0.85)에 묻히므로 정규화하되, 휘슬은 고음이 조밀해
// 같은 피크에서도 훨씬 크게 들리므로 음성보다 낮은 목표치를 쓴다.

export type SfxKey = 'whistleShort' | 'whistleLong'

const SFX_FILE: Record<SfxKey, string> = {
  whistleShort: '짧은휘슬.m4a',
  whistleLong: '마무리휘슬.m4a',
}
/** 휘슬별 목표 피크. 짧은휘슬은 구령마다 울려서 더 낮게 잡았다. */
const SFX_TARGET: Record<SfxKey, number> = {
  whistleShort: 0.55,
  whistleLong: 0.75,
}

const sfx = new Map<SfxKey, NarrPlan>()

async function loadSfx(ac: AudioContext) {
  await Promise.all(
    (Object.keys(SFX_FILE) as SfxKey[]).map(async key => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets/Sound/${encodeURIComponent(SFX_FILE[key])}`)
        if (!res.ok) return
        const buf = await ac.decodeAudioData(await res.arrayBuffer())
        sfx.set(key, analyzeNarration(buf, SFX_TARGET[key]))
      } catch {
        /* 효과음 실패는 무시한다 (게임 진행에 지장 없음) */
      }
    }),
  )
}

export function playSfx(key: SfxKey) {
  const plan = sfx.get(key)
  if (!plan) return
  const ac = audioCtx()
  const src = ac.createBufferSource()
  src.buffer = plan.buf
  const g = ac.createGain()
  g.gain.value = plan.gain
  src.connect(g).connect(ac.destination)
  src.start(ac.currentTime, plan.start, plan.dur)
}

// ─── 나레이션 (튜토리얼·연습 안내) ───
//
// 단어 클립과 달리 **문장**이므로 내부 쉼을 압축하면 억양이 망가진다.
// 앞뒤 무음만 잘라내고 음량만 맞춘다.

type LegacyNarrationKey =
  | 'facePosition' // 얼굴을 원 안에 위치시켜주세요
  | 'handPosition' // 떡방아 기본자세: 양손을 원 안에 위치시켜 주세요
  | 'stretch' // 양팔을 3초간 머리 위로 들어주세요
  | 'genderSelect' // 당신의 성별을 선택해주세요
  | 'guideBlue' // 청기를 들고 있는 사람이 양손을 위로 들어주세요
  | 'guideWhite' // 백기를 들고 있는 사람이 양손을 위로 들어주세요
  | 'guideRight' // 두 사람 모두 오른손을 들어주세요
  | 'guideBoth' // 두 사람 모두 양손을 들어주세요

const NARRATION_DIR = '브레인빌리지v_03_튜토리얼_02가람이'
const NARRATION_FILE: Record<LegacyNarrationKey, string> = {
  facePosition: '01_얼굴을_원_안에_위치시켜주세요',
  handPosition: '02_양손을_원_안에_위치시켜_주세요',
  stretch: '03_양팔을_3초간_머리_위로_들어주세요',
  genderSelect: '04_당신의_성별을_선택해주세요',
  guideBlue: '05_청기를_들고_있는_사람이_양손을_위로_들어주세요',
  guideWhite: '06_백기를_들고_있는_사람이_양손을_위로_들어주세요',
  guideRight: '08_두_사람_모두_오른손을_들어주세요',
  guideBoth: '09_두_사람_모두_양손을_들어주세요',
}
// 원본 MP3의 실측 길이. 로드/재생 실패 시 화면 설명을 읽을 시간으로도 사용한다.
const GUIDANCE_MS = {
  a_practice_left: 2390, b_practice_both: 3580, b_practice_left: 6230,
  b_practice_right: 6410, b_stop: 2490, b_start: 4100,
  b_cue_both: 2430, b_cue_left: 2740, b_cue_right: 2750,
  c_select: 2310, c_practice_pound: 3240, c_practice_squeeze: 3920,
  c_practice_left: 2500, c_practice_right: 2640, c_cue_pound: 1850,
  c_cue_squeeze: 2200, c_cue_left: 2280, c_cue_right: 2320,
  c_swap: 2520, c_finish: 2940, common_result: 4130,
  d_rules: 7590, d_practice: 7250, d_start: 3840, d_correct: 1540,
  d_empty: 2710, d_wrong: 4290, d_complete: 2500,
  d_success: 4040, d_timeout: 3710, d_resume: 5020,
} as const
export type GuidanceKey = keyof typeof GUIDANCE_MS
export type NarrationKey = LegacyNarrationKey | GuidanceKey
// 미사용: 07_두_사람_모두_한손을_들어주세요 (구령은 '왼손'이라 문구 불일치)

interface NarrPlan {
  buf: AudioBuffer
  start: number
  dur: number
  gain: number
}
const narrations = new Map<NarrationKey, NarrPlan>()
let narrSource: AudioBufferSourceNode | null = null
let cancelNarration: (() => void) | null = null

function analyzeNarration(buf: AudioBuffer, targetPeak = TARGET_PEAK): NarrPlan {
  const d = buf.getChannelData(0)
  const sr = buf.sampleRate
  let s = 0
  let e = d.length - 1
  while (s < d.length && Math.abs(d[s]) < SILENCE_TH) s++
  while (e > s && Math.abs(d[e]) < SILENCE_TH) e--
  const pad = 0.02
  const start = Math.max(0, s / sr - pad)
  const end = Math.min(buf.duration, e / sr + pad)
  let peak = 0
  for (let i = Math.round(start * sr); i < Math.round(end * sr); i++) {
    const a = Math.abs(d[i])
    if (a > peak) peak = a
  }
  return {
    buf,
    start,
    dur: end - start,
    gain: peak > 0.01 ? Math.min(6, Math.max(0.5, targetPeak / peak)) : 1,
  }
}

async function loadNarrations(ac: AudioContext) {
  await Promise.all(
    ([...Object.keys(NARRATION_FILE), ...Object.keys(GUIDANCE_MS)] as NarrationKey[]).map(async key => {
      try {
        const guidance = key in GUIDANCE_MS
        const directory = guidance ? 'garam-guidance' : NARRATION_DIR
        const file = guidance ? key : NARRATION_FILE[key as LegacyNarrationKey]
        const url = `${import.meta.env.BASE_URL}assets/Sound/${encodeURIComponent(directory)}/${encodeURIComponent(file)}.mp3`
        const res = await fetch(url)
        if (!res.ok) return
        const buf = await ac.decodeAudioData(await res.arrayBuffer())
        // 새 가람 안내는 자르거나 속도/피치/음량을 바꾸지 않고 원본 전체를 재생한다.
        narrations.set(key, guidance ? { buf, start: 0, dur: buf.duration, gain: 1 } : analyzeNarration(buf))
      } catch {
        /* 개별 나레이션 실패는 화면 텍스트로 대체된다 */
      }
    }),
  )
}

export function stopNarration() {
  cancelNarration?.()
  cancelNarration = null
  if (narrSource) {
    narrSource.onended = null
    try {
      narrSource.stop()
    } catch {
      /* 이미 정지 */
    }
    narrSource.disconnect()
    narrSource = null
  }
}

/** 나레이션을 재생한다. 이미 재생 중인 것은 멈춘다. 재생 길이(ms)를 돌려준다. */
export function playNarration(key: NarrationKey): number {
  stopNarration()
  const plan = narrations.get(key)
  if (!plan) return 0
  const ac = audioCtx()
  const src = ac.createBufferSource()
  src.buffer = plan.buf
  const g = ac.createGain()
  g.gain.value = plan.gain
  src.connect(g).connect(ac.destination)
  src.start(ac.currentTime, plan.start, plan.dur)
  narrSource = src
  src.onended = () => { src.disconnect(); g.disconnect(); if (narrSource === src) narrSource = null }
  return Math.round(plan.dur * 1000)
}

/** 화면 안내 1회. 실제 음성 종료 뒤 진행하며, 취소된 화면의 늦은 로드는 재생하지 않는다. */
export function runNarration(key: NarrationKey, onEnd: () => void = () => {}, minimumMs = 0): () => void {
  stopNarration()
  let cancelled = false
  let started = false
  let source: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  const timers: number[] = []
  const cancel = () => {
    if (cancelled) return
    cancelled = true
    timers.forEach(audioClock.clearTimeout)
    if (source) { source.onended = null; source.stop(); source.disconnect() }
    gain?.disconnect()
    if (narrSource === source) narrSource = null
    if (cancelNarration === cancel) cancelNarration = null
  }
  cancelNarration = cancel
  const start = () => {
    if (cancelled || started) return
    if (audioPaused) { timers.push(audioClock.setTimeout(start, 0)); return }
    started = true
    timers.forEach(audioClock.clearTimeout)
    const plan = narrations.get(key)
    const fallbackMs = key in GUIDANCE_MS ? GUIDANCE_MS[key as GuidanceKey]
      : Math.max(1500, NARRATION_FILE[key as LegacyNarrationKey].length * 130)
    let speechDone = false
    let minimumDone = minimumMs <= 0
    const complete = () => {
      if (cancelled || !speechDone || !minimumDone) return
      // A browser may deliver an already queued onended event just after blur.
      if (audioPaused) { timers.push(audioClock.setTimeout(complete, 0)); return }
      cancel()
      onEnd()
    }
    const ended = () => { speechDone = true; complete() }
    if (!minimumDone) timers.push(audioClock.setTimeout(() => { minimumDone = true; complete() }, minimumMs))
    try {
      const ac = audioCtx()
      if (!plan || ac.state !== 'running') throw new Error('Narration unavailable')
      source = ac.createBufferSource()
      source.buffer = plan.buf
      gain = ac.createGain()
      gain.gain.value = plan.gain
      source.connect(gain).connect(ac.destination)
      narrSource = source
      source.onended = ended
      source.start(ac.currentTime, plan.start, plan.dur)
      // 백그라운드 전환으로 음성 시계만 멈춰도 화면을 영구 대기시키지 않는다.
      timers.push(audioClock.setTimeout(() => {
        if (!speechDone && source) { source.onended = null; source.stop() }
        ended()
      }, plan.dur * 1000 + 1500))
    } catch {
      // 음성을 못 들은 경우에도 같은 설명이 화면에 남을 시간을 보장한다.
      if (source) { source.onended = null; source.disconnect(); if (narrSource === source) narrSource = null; source = null }
      gain?.disconnect()
      timers.push(audioClock.setTimeout(ended, fallbackMs))
    }
  }
  // 느린 네트워크나 오디오 해금 실패가 게임 진행을 막지 않도록 제한한다.
  timers.push(audioClock.setTimeout(start, 4000))
  try { void initAudio().then(start, start) } catch { start() }
  return cancel
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
  audioClock.setTimeout(() => beep(1046, 140), 100)
}

export function greatChime() {
  beep(784, 80)
  audioClock.setTimeout(() => beep(988, 80), 90)
  audioClock.setTimeout(() => beep(1319, 180), 180)
}

export function neutralTick() {
  beep(520, 80, 0.08)
}

/**
 * 역할 교체처럼 규칙이 바뀌는 구간을 알리는 전환음.
 * 안내 음성을 없앤 뒤 이 구간이 완전히 무음이 되어, 참가자가 화면 변화를
 * 놓치지 않도록 정답 차임과 구분되는 소리를 둔다.
 */
export function transitionChime() {
  beep(659, 140, 0.13)
  audioClock.setTimeout(() => beep(523, 140, 0.13), 150)
  audioClock.setTimeout(() => beep(784, 260, 0.13), 300)
}
