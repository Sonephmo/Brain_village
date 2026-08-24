import { FX, IMG, frameSize } from '../assets'
import { Sprite } from '../components/Sprite'
import { beep } from '../game/audio'

// 피그마 1_MainTitle 프레임 그대로. 좌표·크기는 디자인 CSS 값을 사용한다.
//   Image_Main          1920x2075  (0, -23)   ← 프레임보다 커서 아래가 잘린다
//   Title_BrainVillage  1292x727   (314, -23)
//   Button_Start        663x228    (629, 752)
const BTN = frameSize(FX.btnStart, { w: 663 })

export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="fill fade-in" style={{ background: '#FFFFFF' }}>
      <img
        src={IMG.titleMain}
        alt=""
        style={{ position: 'absolute', left: 0, top: -23, width: 1920, height: 2075, objectFit: 'cover' }}
      />
      <img
        src={IMG.titleLogo}
        alt="브레인빌리지"
        style={{ position: 'absolute', left: 314, top: -23, width: 1292, height: 727, objectFit: 'cover' }}
      />
      <div
        role="button"
        aria-label="시작하기"
        style={{
          position: 'absolute',
          left: 629,
          top: 752 + (228 - BTN.height) / 2,
          ...BTN,
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
