# 브레인빌리지 (Brain Village)

고령자 대상 **동작 기반 2인 협동 인지훈련** 웹게임 데모. 마을에서 미니게임을 골라 플레이한다.
데모 수록 게임: **오락가락 청기백기** (청기백기 변형, 2라운드 × 10구령).

## 실행

```bash
npm install
npm run dev     # http://localhost:5199
npm run build   # dist/ 산출
```

인터넷 연결 없이 구동된다 (MediaPipe 모델·wasm·폰트·에셋 전부 로컬 포함).

## 스택

- Vite + React + TypeScript
- MediaPipe Tasks `PoseLandmarker` (lite, GPU delegate) — 프레임 좌/우 분할로 2인 동시 인식
- 구령 음성: Web Speech API TTS (정식 녹음 수령 시 교체 예정)
- 에셋: 피그마 디자인 파일에서 MCP로 추출 (`public/assets/`, 크롭 매니페스트는 `src/assets.ts`)

## 플로우

메인 → 마을(장소 8곳, 학교만 활성) → 튜토리얼(위치잡기 → 캘리브레이션 → 성별선택 → 연습 5구령) → 본게임 20구령 → 결과(팀 점수 + JSON 다운로드)

## 운영(부스) 참고

- 진행요원 예비 키: **1P = Q(왼손)/W(오른손), 2P = O/P** — 홀드가 손들기로 인식됨
- 카메라 사용 불가 시 자동으로 키보드 모드 전환
- 튜토리얼 각 단계 우하단 **건너뛰기** 버튼 (반투명)
- 판정 규칙·채점·로그 스키마: [docs/demo-spec.md](docs/demo-spec.md) 참고 (v1.1)
