import { EFFECT, IMG } from '../assets'
import { Sprite } from '../components/Sprite'
import { beep } from '../game/audio'

// 1_MainTitle + A_1 GameA 프레임 기반: 타이틀 이미지 + 시작 버튼
export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="fill fade-in" style={{ background: '#fff' }}>
      <img src={IMG.title} alt="브레인빌리지" style={{ position: 'absolute', left: 219, top: 108, width: 1536, height: 864, objectFit: 'contain' }} />
      <div
        role="button"
        style={{ position: 'absolute', left: 598, top: 704, width: 778, height: 268, cursor: 'pointer' }}
        onClick={() => {
          beep(880, 100)
          onStart()
        }}
      >
        <Sprite crop={EFFECT.buttonStart.crop} style={{ inset: 0 }} />
      </div>
    </div>
  )
}
