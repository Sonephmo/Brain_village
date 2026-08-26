import { useState } from 'react'
import { IMG } from '../assets'
import { beep } from '../game/audio'
import { loginPlayers, siteAuth } from '../game/auth'

// 2단계: 개인 로그인. 기관이 부여한 두 자리 번호(1~99)를 두 참가자에게서 받는다.
// 실명·생년월일·연락처는 받지 않는다 — 기관 코드 + 번호로만 식별한다.
//
// 참가자가 직접 만지는 화면이므로 **큰 숫자 키패드**로 만든다.
// 텍스트 입력은 손 제스처 커서로 칠 수 없지만 버튼은 눌린다.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '지우기', '0', '다음']

export function PlayerLoginScreen({ onDone }: { onDone: () => void }) {
  const [codes, setCodes] = useState({ p1: '', p2: '' })
  const [active, setActive] = useState<'p1' | 'p2'>('p1')
  const [error, setError] = useState<string | null>(null)
  const site = siteAuth()

  const submit = () => {
    const r = loginPlayers(codes.p1, codes.p2)
    if (r.ok) onDone()
    else setError(r.message)
  }

  const press = (k: string) => {
    beep(660, 45)
    setError(null)
    if (k === '지우기') {
      setCodes(c => ({ ...c, [active]: c[active].slice(0, -1) }))
      return
    }
    if (k === '다음') {
      // 1참가자를 채우던 중이면 2참가자로, 둘 다 찼으면 시작
      if (active === 'p1' && codes.p1) setActive('p2')
      else submit()
      return
    }
    setCodes(c => {
      const cur = c[active]
      if (cur.length >= 2) return c
      const next = cur + k
      // 두 자리가 차면 자동으로 다음 칸으로 넘어간다
      if (next.length === 2 && active === 'p1') window.setTimeout(() => setActive('p2'), 120)
      return { ...c, [active]: next }
    })
  }

  const field = (key: 'p1' | 'p2', label: string) => (
    <div
      role="button"
      aria-label={label}
      onClick={() => setActive(key)}
      style={{ flex: 1, cursor: 'pointer' }}
    >
      <p className="pixel-text" style={{ fontSize: 34, color: '#cfe8d8', textAlign: 'center' }}>
        {label}
      </p>
      <div
        className="pixel-text"
        style={{
          marginTop: 12,
          height: 132,
          lineHeight: '132px',
          fontSize: 92,
          textAlign: 'center',
          color: '#fff',
          background: 'rgba(0,0,0,0.55)',
          border: `6px solid ${active === key ? '#37ff83' : 'rgba(255,255,255,0.35)'}`,
          borderRadius: 14,
          letterSpacing: 14,
        }}
      >
        {codes[key].padEnd(2, '_')}
      </div>
    </div>
  )

  return (
    <div className="fill fade-in">
      <img src={IMG.gameBg} alt="" className="fill" style={{ objectFit: 'cover', filter: 'blur(8px) brightness(0.45)' }} />

      <div className="login-card" style={{ width: 1080, left: 420, top: 92 }}>
        <p className="pixel-text" style={{ fontSize: 60, color: '#fff', textAlign: 'center' }}>
          참가자 확인
        </p>
        <p className="pixel-text" style={{ fontSize: 30, color: '#b9d9c4', textAlign: 'center', marginTop: 10 }}>
          {site ? `${site.siteName} · 부여받은 번호를 눌러주세요` : '부여받은 번호를 눌러주세요'}
        </p>

        <div style={{ display: 'flex', gap: 48, marginTop: 34 }}>
          {field('p1', '1참가자 (왼쪽)')}
          {field('p2', '2참가자 (오른쪽)')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 34 }}>
          {KEYS.map(k => (
            <button
              key={k}
              className="pixel-btn"
              style={{
                fontSize: k.length > 1 ? 34 : 52,
                padding: '16px 0',
                background: k === '다음' ? '#7ce8a0' : k === '지우기' ? '#e8e8e8' : '#ffd85e',
                boxShadow: k === '다음' ? '0 6px 0 #3f9c60' : k === '지우기' ? '0 6px 0 #9a9a9a' : '0 6px 0 #b9962f',
              }}
              onClick={() => press(k)}
            >
              {k}
            </button>
          ))}
        </div>

        {error && (
          <p className="pixel-text" style={{ fontSize: 30, color: '#ff9b9b', textAlign: 'center', marginTop: 20 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
