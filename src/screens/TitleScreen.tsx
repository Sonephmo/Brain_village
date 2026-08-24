import { FX, IMG, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import { beep } from '../game/audio'

// 1_MainTitle 프레임은 디자인에서 비어 있고, 디자인의 TitleBraintable 이미지는
// 다른 프로젝트(브레인테이블) 로고이므로 사용하지 않는다.
// 브레인빌리지 로고 에셋(스펙 §8 브랜딩 1종) 수령 시 이 텍스트 블록을 교체할 것.
export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="fill fade-in" style={{ background: '#0d1b2a' }}>
      <img
        src={IMG.mapBg}
        alt=""
        className="fill"
        style={{ objectFit: 'cover', filter: 'blur(6px) brightness(0.55)' }}
      />

      <p
        className="pixel-text"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 210,
          fontSize: 200,
          textAlign: 'center',
          color: '#fff',
          textShadow: '0 10px 0 rgba(0,0,0,0.6), 0 0 40px rgba(55,255,131,0.45)',
        }}
      >
        브레인빌리지
      </p>
      <p
        className="pixel-text"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 500,
          fontSize: 56,
          textAlign: 'center',
          color: '#37ff83',
          letterSpacing: 8,
        }}
      >
        BRAIN VILLAGE
      </p>
      <p
        className="pixel-text"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 600,
          fontSize: 44,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.8)',
        }}
      >
        둘이 함께하는 몸으로 하는 두뇌 놀이
      </p>

      <div
        role="button"
        style={{
          position: 'absolute',
          left: '50%',
          top: 730,
          transform: 'translateX(-50%)',
          ...frameSize(FX.btnStart, { w: 620 }),
          cursor: 'pointer',
        }}
        onClick={() => {
          beep(880, 100)
          onStart()
        }}
      >
        <Sprite frame={FX.btnStart} style={{ inset: 0 }} />
      </div>
    </div>
  )
}
