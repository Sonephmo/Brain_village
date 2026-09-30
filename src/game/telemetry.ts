/**
 * 수행 데이터 실시간 전송 (Supabase)
 *
 * 설계 원칙
 *  1) 로컬이 정본 — 전송이 실패해도 게임은 절대 멈추지 않는다. 부스에서 네트워크가
 *     끊겨도 참가자는 아무것도 눈치채지 못해야 한다.
 *  2) 실패한 행은 localStorage 큐에 남고, 연결이 돌아오면 자동으로 다시 올라간다.
 *  3) 모든 행의 PK 는 클라이언트가 만든 UUID — 재전송해도 중복이 안 쌓인다(멱등).
 *  4) 개인정보를 담지 않는다. 참가자는 P1/P2 로만 남는다.
 *
 * supabase-js 를 쓰지 않고 fetch 로 PostgREST 를 직접 호출한다.
 * 넣기만 하면 되는데 의존성을 하나 더 들일 이유가 없다.
 */

import { SUPABASE_KEY, SUPABASE_URL } from './supabaseEnv'
import { currentPlayerCodes, currentSiteCode } from './auth'

const URL_BASE = SUPABASE_URL
// 전송은 **항상 publishable 키로** 한다. 기관 로그인으로 받은 사용자 토큰을 쓰면
// RLS 정책이 달라 INSERT 가 막힐 수 있다. 로그인 토큰은 profile 조회에만 쓴다.
const KEY = SUPABASE_KEY
const DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? 'kiosk-unknown'

/**
 * 콘텐츠 코드. T(인지표적)·I(상호의존 패턴)가 확정되면 .env 만 바꾼다.
 * 게임 코드에 박지 않는다 — 표적이 바뀔 때 게임을 다시 건드리지 않기 위한 것이다.
 * content 테이블에서 읽는 방법도 있지만 그 테이블은 아직 비어 있고,
 * 이 키로는 SELECT 가 막혀 «비었다»와 «못 읽는다»를 구분할 수 없다.
 */
export const CONTENT_ID = import.meta.env.VITE_CONTENT_ID ?? 'tmp-orak-flag'

const QUEUE_KEY = 'bv.telemetry.queue.v1'
const REJECTED_KEY = 'bv.telemetry.rejected.v1'
const FLUSH_MS = 5000

export const telemetryEnabled = Boolean(URL_BASE && KEY)

type Row = Record<string, unknown>
type Pending =
  | { kind: 'insert'; table: string; rows: Row[] }
  | { kind: 'rpc'; fn: string; args: Row }
type Queued = Pending & { queueId: string; attempts?: number }
type SendResult = { state: 'sent' | 'retry' | 'rejected' | 'ambiguous'; reason?: string }

const uuid = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

/* ── 큐 ─────────────────────────────────────── */

let memoryQueue: Queued[] = []
let memoryOnly = false

function loadQueue(): Queued[] {
  if (memoryOnly) return memoryQueue
  try {
    const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as (Pending & { queueId?: string })[]
    const q = saved.map(p => ({ ...p, queueId: p.queueId ?? uuid() }))
    // 이전 버전의 재전송 대기 데이터에도 고정 ID를 붙여 그대로 이어받는다.
    if (saved.some(p => !p.queueId)) saveQueue(q)
    memoryQueue = q
    return q
  } catch {
    return memoryQueue
  }
}

function saveQueue(q: Queued[]) {
  memoryQueue = q
  try {
    // 오래된 세션 INSERT를 잘라 버리면 뒤의 수행/종료 기록도 복구할 수 없다.
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    memoryOnly = true
    console.warn('[telemetry] 저장 공간 부족 — 대기 기록을 메모리에 보존합니다. 탭을 닫기 전 연결을 복구해 주세요')
  }
}

function enqueue(p: Pending) {
  const q = loadQueue()
  q.push({ ...p, queueId: uuid() })
  saveQueue(q)
}

/** 서버가 거부한 원문도 보존한다. 불확실한 종료 하나가 이후 세션 전체를 막지 않게 한다. */
function preserveRejected(p: Queued, reason: string): boolean {
  try {
    const rejected = JSON.parse(localStorage.getItem(REJECTED_KEY) ?? '[]') as unknown[]
    rejected.push({ pending: p, reason, recordedAt: new Date().toISOString() })
    localStorage.setItem(REJECTED_KEY, JSON.stringify(rejected))
    console.warn('[telemetry] 서버 확인이 필요한 기록을 별도로 보존했습니다', reason)
    return true
  } catch {
    return false // 별도 보존도 실패하면 원래 큐에서 제거하지 않는다.
  }
}

/* ── 전송 ───────────────────────────────────── */

async function send(p: Pending): Promise<SendResult> {
  if (!telemetryEnabled) return { state: 'retry' }
  const path = p.kind === 'rpc' ? `rpc/${p.fn}` : p.table
  const body = p.kind === 'rpc' ? p.args : p.rows
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Prefer: p.kind === 'insert' ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal',
      },
      body: JSON.stringify(body),
    })

    if ([408, 425, 429].includes(res.status)) return { state: 'retry' }
    // 영구 거부는 버리지 않고 진단/복구용으로 따로 보존한다.
    if (res.status >= 400 && res.status < 500) {
      return { state: 'rejected', reason: `${path} ${res.status}: ${await res.text()}` }
    }
    if (!res.ok) return { state: 'retry' }

    // close_session 은 성공 여부를 boolean 으로 돌려준다.
    // 200 이어도 false 면 «대상 행이 없었다»는 뜻 — 조용한 실패를 여기서 잡는다.
    if (p.kind === 'rpc') {
      const ok = await res.text()
      if (ok.trim() === 'false') {
        return { state: 'ambiguous', reason: 'close_session=false: 대상 없음 또는 이미 종료됨' }
      }
    }
    return { state: 'sent' }
  } catch {
    return { state: 'retry' }
  }
}

/** 전송 중인 항목까지 먼저 저장한 뒤, 단일 소비자가 순서대로 전송한다. */
function push(p: Pending) {
  if (!telemetryEnabled) return
  enqueue(p)
  void flushQueue()
}

let flushing = false

export async function flushQueue() {
  if (flushing || !telemetryEnabled) return
  flushing = true
  try {
    while (true) {
      const pending = loadQueue()[0]
      if (!pending) break
      const result = await send(pending)
      if (result.state === 'retry') break
      if (result.state === 'ambiguous') {
        const attempts = (pending.attempts ?? 0) + 1
        pending.attempts = attempts
        if (attempts < 3) {
          saveQueue(loadQueue().map(p => p.queueId === pending.queueId ? { ...p, attempts } : p))
          break
        }
      }
      if (result.state !== 'sent' && !preserveRejected(pending, result.reason ?? result.state)) break
      // await 중 추가된 항목을 유지하고, 확인한 항목 하나만 ID로 제거한다.
      saveQueue(loadQueue().filter(p => p.queueId !== pending.queueId))
    }
  } finally {
    flushing = false
  }
}

if (telemetryEnabled) {
  window.setInterval(flushQueue, FLUSH_MS)
  window.addEventListener('online', flushQueue)
  // 부스에서 탭을 닫거나 새로고침해도 남은 큐를 한 번 더 시도한다
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushQueue()
  })
}

/* ── 세션 ───────────────────────────────────── */

let sessionId: string | null = null
let startedAt = ''

export function startSession(info: {
  startedAt?: string
  gameKey: string
  appVersion: string
  inputMode: '포즈인식' | '키보드'
}) {
  if (!telemetryEnabled) return null
  sessionId = uuid()
  startedAt = info.startedAt ?? new Date().toISOString()

  push({
    kind: 'insert',
    table: 'session',
    rows: [
      {
        session_id: sessionId,
        device_id: DEVICE_ID,
        site_code: currentSiteCode(),
        started_at: startedAt,
        play_mode: 'pair',
        // 기관이 부여한 두 자리 익명 코드. 인덱스 0 = 1참가자(왼쪽), 1 = 2참가자(오른쪽).
        // 개인정보는 담지 않는다 — 실명·생년월일·연락처는 받지도 않는다.
        player_codes: currentPlayerCodes(),
        game_key: info.gameKey,
        app_version: info.appVersion,
        input_mode: info.inputMode,
        completed: false,
      },
    ],
  })
  return sessionId
}

export function endSession(info: {
  completed: boolean
  teamScore: number
  maxScore: number
  commandsPlayed: number
  abortReason?: string | null
  poseFps?: number | null
}) {
  if (!telemetryEnabled || !sessionId) return
  push({
    kind: 'rpc',
    fn: 'close_session',
    args: {
      p_session_id: sessionId,
      p_completed: info.completed,
      p_team_score: info.teamScore,
      p_max_score: info.maxScore,
      p_commands_played: info.commandsPlayed,
      p_abort_reason: info.abortReason ?? null,
      p_pose_fps: info.poseFps ?? null,
    },
  })
  flushQueue()
  sessionId = null
}

/* ── 구령 1개 = trial 2행 (P1·P2) ───────────── */

import type { CommandLog } from './types'

/**
 * 한 구령에 두 사람의 판정이 함께 붙으므로 행을 둘로 쪼갠다.
 * 같은 자극에서 나온 두 행은 unit_id 로 묶인다 — 협동 지표는 이 단위로 계산한다.
 */
export function logCommand(log: CommandLog, ctx: { contentId: string; index: number }) {
  if (!telemetryEnabled || !sessionId) return

  const unitId = `${sessionId}:${log.구령ID}`
  const isFake = log.구령.includes('?')
  const row = (actor: 'P1' | 'P2') => {
    const j = log.판정[actor]
    return {
      trial_id: uuid(),
      session_id: sessionId,
      unit_id: unitId,
      content_id: ctx.contentId,
      t_code: 'T2', // 억제 — 청기백기의 1차 표적
      i_code: 'I6', // 역할교대. 이 게임에 실재하는 유일한 상호의존 패턴이다
      trial_index: ctx.index,
      level: log.레벨,
      stim_type: isFake ? 'stop' : 'go',
      expected_action: log.기대동작[actor],
      onset_ts: log.구령시작시각,
      rt_ms: j.반응속도ms,
      correct: j.정답,
      error_type: j.오류유형,
      difficulty_level: Number(log.레벨.slice(1)),
      stim_duration_ms: log.발화길이ms,
      score_delta: log.획득점수, // 팀 단위 값 — 합산은 unit_id 로 중복 제거 후
      actor_code: actor,
    }
  }

  push({ kind: 'insert', table: 'trial', rows: [row('P1'), row('P2')] })
}

/* ── 역할교대 (I6) ──────────────────────────── */

/**
 * 라운드 사이 청기↔백기 교체. 고정 분업은 강한 쪽이 보상해 부하를 오히려 낮추므로,
 * 교대가 실제로 일어났다는 기록이 협동 주장의 근거가 된다.
 *
 * I1~I5(기억분담·단서중계·동시협응·선택분기·감시보완)는 이 게임 설계에 없다.
 * 없는 것을 기록하지 않는다.
 */
export function logRoleSwap(swapIndex: number, roundFrom: number, roundTo: number) {
  if (!telemetryEnabled || !sessionId) return
  push({
    kind: 'insert',
    table: 'interaction',
    rows: [
      {
        interaction_id: uuid(),
        session_id: sessionId,
        i_code: 'I6',
        event_type: 'swap',
        success: true,
        occurred_at: new Date().toISOString(),
        payload: { swap_index: swapIndex, round_from: roundFrom, round_to: roundTo },
      },
    ],
  })
}

/* ── 동작 지표 (1초 창) ─────────────────────── */

import type { MotionWindow } from './motion'

/**
 * 동작 창은 초당 2행(P1·P2)이라 건건이 보내면 요청이 너무 잦다.
 * motion.ts 가 5초치씩 묶어서 넘겨준다.
 */
export function logMotionWindows(windows: MotionWindow[]) {
  if (!telemetryEnabled || !sessionId || !windows.length) return
  const sid = sessionId
  push({
    kind: 'insert',
    table: 'motion_window',
    rows: windows.map(w => ({
      window_id: uuid(),
      session_id: sid,
      posture: null, // 앉음/섬을 판별할 근거가 없다. 추측해서 넣지 않는다.
      ...w,
    })),
  })
}

export const currentSessionId = () => sessionId
