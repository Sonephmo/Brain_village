/**
 * 로그인 — 2단계.
 *
 *  1) 기관 로그인: 별도 웹에서 등록한 계정(이메일+비밀번호)으로 Supabase Auth 에 인증하고,
 *     그 계정의 `profile.site_code` 를 기관 코드로 삼는다.
 *     **한 번 하면 수동으로 끄지 않는 이상 이 기기에서 유지된다** — localStorage 에 남는다.
 *     로그인 토큰(access_token)은 보관하지 않는다. 필요한 건 site_code 하나뿐이고,
 *     토큰을 들고 있으면 만료·갱신을 관리해야 하는데 그럴 이유가 없다.
 *
 *  2) 개인 로그인: 기관이 부여한 두 자리 번호(1~99) 두 개. 실명·생년월일·연락처는 받지 않는다.
 *     `session.player_codes` 에 [1참가자, 2참가자] 순서로 들어간다.
 *
 * 왜 기관명이 아니라 이메일인가: 서버 `site` 테이블은 익명 키로 읽을 수 없고(RLS),
 * 비밀번호도 `site` 가 아니라 Auth 에 있다. 기관명 → 계정을 찾을 방법이 지금 없다.
 * 기관명으로 받으려면 `login_site(기관명, 비밀번호)` RPC 가 서버에 필요하다.
 */

import { DEFAULT_SITE_CODE, SUPABASE_KEY, SUPABASE_URL } from './supabaseEnv'

/**
 * 진행요원 테스트 계정 — 서버를 거치지 않는 로컬 우회.
 *
 * ⚠ 이 저장소는 공개이고 이 값은 번들에도 그대로 들어간다. 누구나 볼 수 있다.
 *   그래도 서버 권한을 주지는 않는다 — 게임 화면만 열고 기관 코드는 `.env` 기본값을 쓴다.
 *   (그 권한은 이미 번들에 있는 publishable 키가 가진 것과 같다.)
 *   실제 자격증명으로 재사용하면 안 된다.
 */
const STAFF_ID = 'sonephmo'
const STAFF_PW = '6875'

const SITE_KEY = 'bv.auth.site.v1'
const PLAYER_KEY = 'bv.auth.players.v1'

export interface SiteAuth {
  siteCode: string
  /** 화면에 보여줄 기관명. 못 읽었으면 코드를 그대로 쓴다. */
  siteName: string
  /** 로그인에 쓴 계정(이메일) 또는 진행요원 ID */
  account: string
  mode: 'auth' | 'staff'
}

export interface PlayerAuth {
  /** 1참가자(왼쪽) 두 자리 코드 */
  p1: string
  /** 2참가자(오른쪽) 두 자리 코드 */
  p2: string
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 저장 공간이 없어도 이번 세션은 진행된다 */
  }
}

let site: SiteAuth | null = read<SiteAuth>(SITE_KEY)
let players: PlayerAuth | null = read<PlayerAuth>(PLAYER_KEY)

export const siteAuth = () => site
export const playerAuth = () => players

/** 전송에 쓰는 기관 코드. 로그인 전이면 `.env` 기본값. */
export const currentSiteCode = () => site?.siteCode ?? DEFAULT_SITE_CODE

/** 전송에 쓰는 참가자 코드 [1참가자, 2참가자]. 개인 로그인 전이면 익명 고정값. */
export const currentPlayerCodes = () => (players ? [players.p1, players.p2] : ['P1', 'P2'])

export type LoginResult = { ok: true } | { ok: false; message: string }

/** 두 자리로 정규화. 1~99 밖이면 null */
export function normalizeCode(input: string): string | null {
  const n = Number(input.trim())
  if (!Number.isInteger(n) || n < 1 || n > 99) return null
  return String(n).padStart(2, '0')
}

async function json(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export async function loginSite(id: string, password: string): Promise<LoginResult> {
  const account = id.trim()
  if (!account || !password) return { ok: false, message: '아이디와 비밀번호를 입력해주세요' }

  // 진행요원 테스트 계정 — 서버를 부르지 않는다
  if (account === STAFF_ID && password === STAFF_PW) {
    site = { siteCode: DEFAULT_SITE_CODE, siteName: '운영자(테스트)', account, mode: 'staff' }
    write(SITE_KEY, site)
    return { ok: true }
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, message: '서버 설정(.env)이 없어 기관 로그인을 할 수 없습니다' }
  }

  let token: string
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account, password }),
    })
    const body = await json(res)
    if (!res.ok) {
      // 서버가 주는 이유를 그대로 보여주지 않는다 — 계정 존재 여부를 알려줄 이유가 없다
      const why = body?.error_code === 'invalid_credentials' ? '아이디 또는 비밀번호가 맞지 않습니다' : (body?.msg ?? '로그인에 실패했습니다')
      return { ok: false, message: why }
    }
    token = body?.access_token
    if (!token) return { ok: false, message: '로그인 응답이 올바르지 않습니다' }
  } catch {
    return { ok: false, message: '서버에 연결할 수 없습니다 — 네트워크를 확인해주세요' }
  }

  // 계정에 딸린 기관 코드를 읽는다. 이건 **사용자 토큰**으로만 읽힌다(익명 키로는 RLS 에 막힌다).
  const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }
  const prof = await fetch(`${SUPABASE_URL}/rest/v1/profile?select=site_code,display_name&limit=1`, { headers: auth })
    .then(json)
    .catch(() => null)
  const siteCode: string | undefined = prof?.[0]?.site_code
  if (!siteCode) {
    return {
      ok: false,
      message: '계정은 확인됐지만 기관 정보를 읽을 수 없습니다.\n관리자에게 profile 조회 권한을 요청해주세요.',
    }
  }

  // 기관명은 있으면 좋고 없어도 된다 — 실패해도 코드를 그대로 쓴다
  const siteRow = await fetch(`${SUPABASE_URL}/rest/v1/site?site_code=eq.${encodeURIComponent(siteCode)}&select=name&limit=1`, { headers: auth })
    .then(json)
    .catch(() => null)

  site = {
    siteCode,
    siteName: siteRow?.[0]?.name ?? prof?.[0]?.display_name ?? siteCode,
    account,
    mode: 'auth',
  }
  write(SITE_KEY, site)
  return { ok: true }
}

/** 개인 로그인. 두 코드가 1~99 가 아니면 거부한다. */
export function loginPlayers(p1: string, p2: string): LoginResult {
  const a = normalizeCode(p1)
  const b = normalizeCode(p2)
  if (!a) return { ok: false, message: '1참가자 코드는 1~99 사이여야 합니다' }
  if (!b) return { ok: false, message: '2참가자 코드는 1~99 사이여야 합니다' }
  if (a === b) return { ok: false, message: '두 참가자의 코드가 같습니다' }
  players = { p1: a, p2: b }
  write(PLAYER_KEY, players)
  return { ok: true }
}

/** 기관 로그아웃 — 개인 로그인도 함께 지운다 (다른 기관의 번호를 물려받으면 안 된다) */
export function logoutSite() {
  site = null
  players = null
  try {
    localStorage.removeItem(SITE_KEY)
    localStorage.removeItem(PLAYER_KEY)
  } catch {
    /* 무시 */
  }
}

export function logoutPlayers() {
  players = null
  try {
    localStorage.removeItem(PLAYER_KEY)
  } catch {
    /* 무시 */
  }
}
