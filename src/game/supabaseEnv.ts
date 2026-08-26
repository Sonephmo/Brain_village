// Supabase 접속값. telemetry(쓰기)와 auth(로그인) 두 곳이 함께 쓰므로 여기 한 곳에 둔다.
// (telemetry ↔ auth 가 서로를 import 하면 순환이 된다)
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? ''

/**
 * 기관 로그인 전(또는 진행요원 테스트 계정)에 쓰는 기본 기관 코드.
 * `report.site_code` 는 서버 `site` 테이블에 FK 가 걸려 있어 **등록된 값이어야 한다**.
 * 등록되지 않은 값이면 세션 종료(close_session)가 409 로 조용히 실패한다 (스펙 §25.2).
 */
export const DEFAULT_SITE_CODE = import.meta.env.VITE_SITE_CODE ?? 'demo'
