import { useEffect, useRef, useState } from 'react'
import { IMG } from '../assets'
import { loginSite } from '../game/auth'

// 1단계: 기관 로그인. 진행요원이 부스를 열 때 한 번만 하고, 이후 기기에 유지된다.
// BGM 없음 — 로그인 화면은 조용해야 한다.
//
// 이메일·비밀번호는 텍스트 입력이라 손 커서로 칠 수 없다. 진행요원이 키보드로 하는
// 화면이므로 그대로 둔다. 참가자가 만지는 개인 로그인 쪽만 키패드로 만든다.
export function SiteLoginScreen({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef<HTMLInputElement>(null)

  useEffect(() => idRef.current?.focus(), [])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await loginSite(id, pw)
    setBusy(false)
    if (r.ok) onDone()
    else setError(r.message)
  }

  return (
    <div className="fill fade-in">
      <img src={IMG.gameBg} alt="" className="fill" style={{ objectFit: 'cover', filter: 'blur(8px) brightness(0.45)' }} />

      <div className="login-card" style={{ width: 900, left: 510, top: 210 }}>
        <p className="pixel-text" style={{ fontSize: 64, color: '#fff', textAlign: 'center' }}>
          기관 로그인
        </p>
        <p className="pixel-text" style={{ fontSize: 28, color: '#b9d9c4', textAlign: 'center', marginTop: 14 }}>
          한 번 로그인하면 이 기기에서 계속 유지됩니다
        </p>

        <label className="pixel-text login-label" htmlFor="site-id">아이디 (기관 계정 이메일)</label>
        <input
          id="site-id"
          ref={idRef}
          className="login-input"
          value={id}
          autoComplete="username"
          onChange={e => setId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
        />

        <label className="pixel-text login-label" htmlFor="site-pw">비밀번호</label>
        <input
          id="site-pw"
          className="login-input"
          type="password"
          value={pw}
          autoComplete="current-password"
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
        />

        {error && (
          <p className="pixel-text" style={{ fontSize: 30, color: '#ff9b9b', marginTop: 22, whiteSpace: 'pre-line' }}>
            {error}
          </p>
        )}

        <button
          className="pixel-btn"
          style={{ display: 'block', margin: '32px auto 0', fontSize: 44, opacity: busy ? 0.5 : 1 }}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? '확인 중…' : '로그인'}
        </button>
      </div>
    </div>
  )
}
