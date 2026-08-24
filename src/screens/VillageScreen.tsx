import { useState } from 'react'
import { IMG, PLACES, type Place } from '../assets'
import { beep } from '../game/audio'

// 2_GameMap: 마을에서 미니게임 선택.
//
// 건물 그림은 map_bg 배경에 통째로 그려져 있어 개별 건물만 채도를 조절할 수 없다.
// 그래서 지도를 두 겹으로 깔고, 아래는 채도를 낮춘 사본 / 위는 원색 사본을 호버한
// 건물 주변만 원형으로 clip 해서 남긴다 → 나머지가 흐려지는 스포트라이트가 된다.
export function VillageScreen({ onEnterGame }: { onEnterGame: () => void }) {
  const [hover, setHover] = useState<Place | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1400)
  }

  // 스포트라이트 원: 건물을 넉넉히 감싸는 크기
  const cx = hover ? hover.x + hover.w / 2 : 960
  const cy = hover ? hover.y + hover.h / 2 : 540
  const r = hover ? Math.max(hover.w, hover.h) * 0.78 : 0

  // 설명 패널은 호버한 건물의 반대쪽에 띄워 건물을 가리지 않게 한다
  const panelOnRight = cx < 960
  const desc = hover ? DESC[hover.key] : null

  return (
    <div className="fill fade-in" onMouseLeave={() => setHover(null)}>
      {/* 아래 겹: 호버 중이면 채도·밝기를 낮춘다 */}
      <img
        src={IMG.mapBg}
        alt="마을"
        className="fill"
        style={{
          objectFit: 'cover',
          filter: hover ? 'saturate(0.2) brightness(0.62)' : 'none',
          transition: 'filter 0.28s ease-out',
        }}
      />
      {/* 위 겹: 호버한 건물만 원색으로 남는다 */}
      <img
        src={IMG.mapBg}
        alt=""
        className="fill"
        style={{
          objectFit: 'cover',
          clipPath: `circle(${r}px at ${cx}px ${cy}px)`,
          transition: 'clip-path 0.3s ease-out',
          pointerEvents: 'none',
          opacity: hover ? 1 : 0,
        }}
      />

      {PLACES.map(p => (
        <div
          key={p.key}
          className="hotspot"
          style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
          onMouseEnter={() => setHover(p)}
          onFocus={() => setHover(p)}
          onClick={() => {
            beep(700, 80)
            if (p.active) onEnterGame()
            else showToast('준비중입니다!')
          }}
        >
          {/* 호버 강조 링 (피그마 Place_* 노드의 #37ff83 글로우) */}
          <div
            className="glow"
            style={{
              position: 'absolute',
              inset: -12,
              borderRadius: '50%',
              boxShadow: '0 0 60px 20px rgba(55,255,131,0.45)',
            }}
          />
        </div>
      ))}

      {/* 호버한 곳의 설명 — 크게 */}
      {hover && desc && (
        <div
          className="village-panel"
          style={{
            position: 'absolute',
            top: 250,
            left: panelOnRight ? 1090 : 70,
            width: 760,
          }}
        >
          <p className="pixel-text" style={{ fontSize: 58, color: '#fff', whiteSpace: 'nowrap' }}>
            {desc.place}
          </p>
          {desc.game && (
            <p className="pixel-text" style={{ fontSize: 46, color: '#37ff83', marginTop: 8, whiteSpace: 'nowrap' }}>
              {desc.game}
            </p>
          )}
          <p className="pixel-text" style={{ fontSize: 34, color: '#e8e8e8', lineHeight: 1.6, marginTop: 22 }}>
            {desc.body}
          </p>
          <p
            className="pixel-text"
            style={{ fontSize: 36, color: desc.active ? '#ffd83a' : '#9a9a9a', marginTop: 24, whiteSpace: 'nowrap' }}
          >
            {desc.active ? '▶ 눌러서 시작하기' : '준비중입니다'}
          </p>
        </div>
      )}

      {toast && <div className="toast pixel-text pop">{toast}</div>}
    </div>
  )
}

// 마을 오버레이 카피. 학교 본문은 디자인 2_GameMap_Overlay 문구를 그대로 쓴다.
interface Desc {
  place: string
  game?: string
  body: string
  active: boolean
}
const DESC: Record<string, Desc> = {
  school: {
    place: '초등학교',
    game: '오락가락 청기백기',
    body: '초등학교 운동회날, 청기백기 종목에 참가합니다\n1등 상품은 제주도 여행패키지\n현재 1등팀은 89점!\n90점을 달성해서 제주도로 여행을 떠나요!',
    active: true,
  },
  cafe: { place: '카페', body: '커피 한 잔 하며 쉬어가는 곳', active: false },
  mountain: { place: '전망대', body: '마을이 한눈에 보이는 곳', active: false },
  hospital: { place: '병원', body: '건강을 돌보는 곳', active: false },
  mart: { place: '마트', body: '장보기 한판 승부', active: false },
  pharmacy: { place: '약국', body: '약봉지를 잘 챙겨야죠', active: false },
  bank: { place: '은행', body: '숫자와 기억력 놀이', active: false },
  health: { place: '보건소', body: '몸을 움직이는 시간', active: false },
}
