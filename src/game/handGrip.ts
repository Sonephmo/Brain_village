/** A detected, moving hand is different from a hand that has left the camera. */
export type HandGrip = 'open' | 'closed' | 'closing' | 'unknown'
export type HandPoint = { x: number; y: number; z?: number }
export type GestureScore = { categoryName?: string; score?: number }
export type HandObservation = {
  landmarks: HandPoint[]
  worldLandmarks?: HandPoint[]
  gesture?: GestureScore
}
const valid = (points: HandPoint[] | undefined): points is HandPoint[] =>
  !!points && points.length === 21 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z)))
const distance = (a: HandPoint, b: HandPoint) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))

/** Rotation/scale independent finger extension. Thumb position need not match a canned pose. */
export function inspectHand(observation: HandObservation, aspect = 1) {
  const missing = { grip: 'unknown' as HandGrip, source: 'none', extended: 0, folded: 0 }
  if (!valid(observation.landmarks)) return missing
  const points = valid(observation.worldLandmarks) ? observation.worldLandmarks : observation.landmarks.map(p => ({
    x: p.x * aspect, y: p.y, z: (p.z ?? 0) * aspect,
  }))
  if (distance(points[0], points[9]) < 1e-5) return missing
  let extended = 0, folded = 0
  for (const base of [5, 9, 13, 17]) {
    const [mcp, pip, dip, tip] = points.slice(base, base + 4)
    const length = distance(mcp, pip) + distance(pip, dip) + distance(dip, tip)
    if (length < 1e-5) return missing
    const straightness = distance(mcp, tip) / length
    const reach = distance(points[0], tip) / Math.max(1e-5, distance(points[0], mcp))
    if (straightness >= .85 && reach >= 1.3) extended++
    else if (straightness <= .65 || reach <= 1.15) folded++
  }
  const category = observation.gesture?.categoryName
  const confident = (observation.gesture?.score ?? 0) >= .55
  const grip: HandGrip = confident && category === 'Open_Palm' ? 'open'
    : confident && category === 'Closed_Fist' ? 'closed'
    : extended >= 3 && folded === 0 ? 'open' : folded === 4 ? 'closed' : 'closing'
  return { grip, source: confident && (category === 'Open_Palm' || category === 'Closed_Fist') ? 'gesture' : 'landmarks', extended, folded }
}

export function pairedGrip(hands: HandGrip[]): HandGrip {
  if (hands.length !== 2 || hands.includes('unknown')) return 'unknown'
  if (hands.every(hand => hand === 'open')) return 'open'
  if (hands.every(hand => hand === 'closed')) return 'closed'
  return 'closing'
}

/** Results come from one player's crop, so array order and raw wrist x cannot change ownership. */
export function classifyPlayerHands(result: {
  landmarks: HandPoint[][]
  worldLandmarks?: HandPoint[][]
  gestures?: Array<Array<GestureScore>>
}, aspect = 1): HandGrip {
  return pairedGrip(result.landmarks.map((landmarks, i) => inspectHand({
    landmarks, worldLandmarks: result.worldLandmarks?.[i], gesture: result.gestures?.[i]?.[0],
  }, aspect).grip))
}
