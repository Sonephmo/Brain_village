// 웹캠 스트림을 한 곳에서 소유한다.
//
// 타이틀은 손 인식(HandLandmarker), 게임은 몸 인식(PoseLandmarker)을 쓰는데
// getUserMedia를 각자 부르면 같은 장치를 두 번 열게 되어 실패하거나 프레임이 끊긴다.
// 그래서 스트림·비디오 엘리먼트는 여기서 한 번만 만들고 양쪽이 공유한다.

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let opening: Promise<HTMLVideoElement | null> | null = null
let error: string | null = null

/** 카메라를 열고(이미 열려 있으면 재사용) 재생 중인 video 엘리먼트를 돌려준다. */
export function openCamera(): Promise<HTMLVideoElement | null> {
  if (video) return Promise.resolve(video)
  if (opening) return opening
  opening = (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.srcObject = stream
      await v.play()
      // readyState만으로는 해상도가 0x0인 순간이 있어 metadata를 기다린다
      if (!v.videoWidth) {
        await new Promise<void>(res => {
          const done = () => {
            v.removeEventListener('loadedmetadata', done)
            res()
          }
          v.addEventListener('loadedmetadata', done)
          window.setTimeout(done, 3000)
        })
      }
      video = v
      return v
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return null
    }
  })()
  return opening
}

export function cameraStream(): MediaStream | null {
  return stream
}

export function cameraVideo(): HTMLVideoElement | null {
  return video
}

export function cameraError(): string | null {
  return error
}

export function cameraReady(): boolean {
  return !!video && video.readyState >= 2 && video.videoWidth > 0
}

export function closeCamera() {
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  video = null
  opening = null
}
