import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Exercise the standalone movement rules without a browser, webcam, or test framework.
const source = await readFile(new URL('../src/game/gameC.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const { RiceActionTracker, RiceFinishTracker, RiceMotion, RICE_MOTION_REST, ricePoundPose, RICE_CUES, ricePlayerStats, freshRiceResult } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const rest = { tracked: true, left: false, right: false, aboveHead: false, grip: 'open' }
// Pounding requires both hands raised; overhead is reserved for the finishing pose.
const up = { ...rest, left: true, right: true, aboveHead: false }
const cue = { action: 'pound', player: 1, round: 1 }
function feed(tracker, input, at) {
  return [tracker.update(input, at), tracker.update(input, at + 130)].filter(Boolean)
}

const waiting = new RiceActionTracker('pound', 0)
for (const at of [0, 200, 600, 1200, 1800]) assert.deepEqual(feed(waiting, rest, at), [])
assert.equal(waiting.complete, false, 'Resting DOWN is not a completed downstroke')
assert.equal(waiting.result(cue).outcome, 'missed')
assert.equal(waiting.movementAt, null)
assert.equal(ricePoundPose(rest), 'down')
assert.equal(ricePoundPose(up), 'up')
assert.equal(ricePoundPose({ ...rest, left: true }), 'down')
assert.equal(ricePoundPose({ ...up, tracked: false }), 'down')

const pound = new RiceActionTracker('pound', 0)
assert.deepEqual(feed(pound, rest, 0), [])
assert.deepEqual(feed(pound, up, 200), [], 'Stars must not appear on the upswing')
assert.equal(pound.complete, false, 'Raising alone must never earn a point')
assert.deepEqual(feed(pound, rest, 450), ['star'], 'One downstroke emits one star burst')
assert.deepEqual(feed(pound, rest, 700), [], 'Holding a completed pose must not repeat an effect')
assert.equal(pound.complete, true)
assert.equal(pound.count, 1)
assert.equal(pound.result(cue).reactionMs, 200)

const lost = new RiceActionTracker('pound', 0)
feed(lost, rest, 0); feed(lost, up, 200)
assert.deepEqual(feed(lost, { ...rest, tracked: false }, 400), [])
assert.deepEqual(feed(lost, rest, 600), [], 'Tracking loss must not create an impact effect')
assert.equal(lost.complete, false, 'Tracking loss is not a downstroke')

const stale = new RiceActionTracker('pound', 0)
feed(stale, up, 0); feed(stale, rest, 200)
assert.equal(stale.complete, false, 'A hand already raised at onset must not count')
feed(stale, up, 400); feed(stale, rest, 600)
assert.equal(stale.complete, true)

const squeeze = new RiceActionTracker('squeeze', 0)
feed(squeeze, rest, 0)
for (let n = 0; n < 3; n++) {
  assert.deepEqual(feed(squeeze, { ...rest, grip: 'closed' }, 200 + n * 400), [])
  assert.equal(squeeze.complete, false, 'Closing is not a full open-close-open cycle')
  assert.deepEqual(feed(squeeze, rest, 400 + n * 400), ['mix'], 'Every full kneading cycle emits a mix puff')
  assert.equal(squeeze.count, n + 1)
  assert.equal(squeeze.complete, n === 2)
}
assert.deepEqual(feed(squeeze, rest, 1700), [], 'The third cycle must not emit twice')
const noise = new RiceActionTracker('squeeze', 0)
feed(noise, rest, 0)
assert.equal(noise.update({ ...rest, grip: 'closed' }, 200), undefined)
assert.equal(noise.update(rest, 230), undefined)
assert.equal(noise.count, 0, 'Short noisy gesture cannot count')
assert.equal(noise.movementAt, null, 'Noisy input must not start a visual motion')

const motion = new RiceMotion()
assert.deepEqual(motion.sample(0), RICE_MOTION_REST)
motion.strike(500)
assert.equal(motion.sample(500).dough, 1)
assert.equal(motion.sample(799).dough, 1)
assert.deepEqual(motion.sample(800), RICE_MOTION_REST, 'A downstroke returns to Dough_04 after its short motion')
motion.assist(1000)
assert.deepEqual([0, 150, 300, 450, 600].map(t => motion.sample(1000 + t).dough), [2, 4, 3, 4, 2])
assert.deepEqual([0, 150, 300, 450, 600].map(t => motion.sample(1000 + t).assistPose), ['squeeze-1', 'squeeze-2', 'squeeze-1', 'squeeze-2', 'squeeze-1'])
assert.deepEqual(motion.sample(1750), RICE_MOTION_REST, 'Stopping returns both the assistant and dough to rest')
motion.assist(2000)
motion.assist(2300)
assert.equal(motion.sample(2300).dough, 3, 'Continued actions extend the loop without restarting its frame')
assert.equal(motion.sample(2750).assistPose, 'squeeze-2')
assert.deepEqual(motion.sample(3050), RICE_MOTION_REST)
motion.assist(3200)
assert.deepEqual(motion.sample(3300, true), RICE_MOTION_REST, 'Reduced motion disables decorative loops')
motion.reset()
assert.deepEqual(motion.sample(3350), RICE_MOTION_REST, 'Cue changes and tracking loss cancel animation')

// Exercise the same tracker-to-motion signals used by the screen.
const kneading = new RiceActionTracker('squeeze', 0)
const kneadingMotion = new RiceMotion()
function knead(input, now) {
  const previousMovement = kneading.movementAt
  kneading.update(input, now)
  if (kneading.movementAt !== previousMovement) kneadingMotion.assist(now)
}
knead(rest, 0); knead(rest, 130)
assert.deepEqual(kneadingMotion.sample(130), RICE_MOTION_REST)
knead({ ...rest, grip: 'closed' }, 200); knead({ ...rest, grip: 'closed' }, 330)
assert.equal(kneading.complete, false)
assert.equal(kneadingMotion.sample(330).assistPose, 'squeeze-1', 'Kneading animates while performing, before all three cycles finish')
knead({ ...rest, grip: 'closed' }, 1300)
assert.deepEqual(kneadingMotion.sample(1300), RICE_MOTION_REST, 'Holding the same pose does not keep the loop alive')

const finish = new RiceFinishTracker()
const overhead = { ...up, aboveHead: true }
assert.equal(finish.update([overhead, overhead], 0), 0)
assert.equal(finish.update([overhead, overhead], 1200), 0, 'Preheld finishing pose needs a fresh raise')
finish.update([rest, rest], 1400)
assert.equal(finish.update([overhead, rest], 1600), 0, 'One player is insufficient')
assert.equal(finish.update([up, up], 3000), 0, 'Ordinary raising is not overhead')
finish.update([overhead, overhead], 3200)
assert.equal(finish.update([overhead, overhead], 3800), 0.6)
assert.equal(finish.update([overhead, { ...overhead, tracked: false }], 3900), 0, 'Tracking loss resets the hold')
finish.update([overhead, overhead], 4000)
assert.equal(finish.update([overhead, overhead], 5000), 1)

const left = new RiceActionTracker('left', 0)
feed(left, rest, 0)
assert.deepEqual(feed(left, { ...rest, right: true }, 200), [], 'The wrong hand produces no mix effect')
assert.equal(left.result({ ...cue, action: 'left' }).outcome, 'wrong')
const missing = new RiceActionTracker('right', 0)
feed(missing, rest, 0)
assert.equal(missing.result({ ...cue, action: 'right' }).outcome, 'missed')
for (const hand of ['left', 'right']) {
  const assist = new RiceActionTracker(hand, 0)
  feed(assist, rest, 0)
  assert.deepEqual(feed(assist, { ...rest, [hand]: true }, 200), ['mix'])
  assert.deepEqual(feed(assist, { ...rest, [hand]: true }, 400), [])
}

assert.equal(RICE_CUES.length, 20)
for (const round of [1, 2]) for (const player of [1, 2]) {
  assert.equal(RICE_CUES.filter(c => c.round === round && c.player === player).length, 5)
}
assert.ok(RICE_CUES.slice(0, 10).filter(c => c.action === 'pound').every(c => c.player === 1))
assert.ok(RICE_CUES.slice(10).filter(c => c.action === 'pound').every(c => c.player === 2))
const aborted = { ...freshRiceResult(), trials: [{ ...cue, outcome: 'correct', reactionMs: 200, completionMs: 600 }] }
assert.equal(ricePlayerStats(aborted, 1).rating, 0, 'One successful action before abort is not a perfect score')
assert.equal(ricePlayerStats(freshRiceResult(), 1).rating, 0)
assert.equal(ricePlayerStats(aborted, 1).score, 5, 'One success fills half a moon, without rounding to a whole rating')
assert.equal(ricePlayerStats(aborted, 1).maxScore, 50, 'Aborting does not shrink the score gauge capacity')
assert.equal(ricePlayerStats(aborted, 2).score, 0, 'The other player does not receive the same score')
const scoredRun = { ...freshRiceResult(), trials: RICE_CUES.map(cue => ({ ...cue,
  outcome: cue.player === 1 || cue.round === 2 ? 'correct' : 'missed', reactionMs: 200, completionMs: 600 })) }
assert.equal(ricePlayerStats(scoredRun, 1).score, 50, 'Player 1 keeps their points across the role swap')
assert.equal(ricePlayerStats(scoredRun, 2).score, 25, 'Player 2 only fills their own gauge with successful actions')
assert.equal(ricePlayerStats(scoredRun, 2).maxScore, 50)
console.log('Game C: UP/DOWN acceptance, live mallet poses, dough/assistant motion sequences, idle/reset/reduced motion, gesture effects, finishing pose, and scoring regressions passed.')
