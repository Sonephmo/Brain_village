import { useState } from 'react'
import { IMG, PLACES } from '../assets'
import { Sprite } from '../components/Sprite'
import { beep } from '../game/audio'

// 2_GameMap: 마을에서 미니게임 선택. 활성 1종(초등학교=청기백기), 나머지 "준비중"
export function VillageScreen({ onEnterGame }: { onEnterGame: () => void }) {
  const [overlay, setOverlay] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1400)
  }

  return (
    <div className="fill fade-in">
      <img src={IMG.mapBg} alt="마을" className="fill" style={{ objectFit: 'cover' }} />

      {PLACES.map(p => (
        <div
          key={p.key}
          className="hotspot"
          style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
          onClick={() => {
            beep(700, 80)
            if (p.active) setOverlay(true)
            else showToast('준비중입니다!')
          }}
        >
          {/* 호버 시 건물 컷아웃 + 발광 (피그마 Place_* 노드의 #37ff83 글로우) */}
          <div className="glow" style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 0 28px #37ff83) drop-shadow(0 0 10px #37ff83)' }}>
            <Sprite crop={p.crop} style={{ inset: 0 }} />
          </div>
          <div className="label pixel-text">{p.label}</div>
        </div>
      ))}

      {toast && <div className="toast pixel-text pop">{toast}</div>}

      {overlay && (
        <div
          className="fill fade-in"
          style={{ background: 'rgba(0,0,0,0.45)', zIndex: 20 }}
          onClick={() => setOverlay(false)}
        >
          {/* 2_GameMap_Overlay: 게임 소개 카드 */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 856,
              background: 'rgba(0,0,0,0.85)',
              borderRadius: 8,
              padding: '26px 50px 40px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <p className="pixel-text" style={{ color: '#fff', fontSize: 48, textAlign: 'center', marginBottom: 30 }}>
              오락가락 청기백기
            </p>
            <p className="pixel-text" style={{ color: '#fff', fontSize: 32 }}>
              {'초등학교 운동회날, 청기백기 종목에 참가합니다\n1등 상품은 제주도 여행패키지\n현재 1등팀은 89점!\n90점을 달성해서 제주도로 여행을 떠나요!'}
            </p>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 36 }}>
              <button
                className="pixel-btn"
                onClick={() => {
                  beep(880, 100)
                  onEnterGame()
                }}
              >
                시작하기
              </button>
              <button className="pixel-btn secondary" onClick={() => setOverlay(false)}>
                돌아가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
