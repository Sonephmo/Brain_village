import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Exercise the standalone movement rules without a browser, webcam, or test framework.
const source = await readFile(new URL('../src/game/gameC.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const { RiceActionTracker, RiceFinishTracker, RICE_CUES, ricePlayerStats, freshRiceResult } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const rest = { tracked: true, left: false, right: false, aboveHead: false, grip: 'open' }
// Pounding requires both hands raised; overhead is reserved for the finishing pose.
const up = { ...rest, left: true, right: true, aboveHead: false }
const cue = { action: 'pound', player: 1, round: 1 }
function feed(tracker, input, at) { tracker.update(input, at); tracker.update(input, at + 130) }

const pound = new RiceActionTracker('pound', 0)
feed(pound, rest, 0); feed(pound, up, 200)
assert.equal(pound.complete, false, 'Raising alone must never earn a point')
feed(pound, rest, 450)
assert.equal(pound.complete, true)
assert.equal(pound.count, 1)
assert.equal(pound.result(cue).reactionMs, 200)

const lost = new RiceActionTracker('pound', 0)
feed(lost, rest, 0); feed(lost, up, 200)
feed(lost, { ...rest, tracked: false }, 400); feed(lost, rest, 600)
assert.equal(lost.complete, false, 'Tracking loss is not a downstroke')

const stale = new RiceActionTracker('pound', 0)
feed(stale, up, 0); feed(stale, rest, 200)
assert.equal(stale.complete, false, 'A hand already raised at onset must not count')
feed(stale, up, 400); feed(stale, rest, 600)
assert.equal(stale.complete, true)

const squeeze = new RiceActionTracker('squeeze', 0)
feed(squeeze, rest, 0)
for (let n = 0; n < 3; n++) {
  feed(squeeze, { ...rest, grip: 'closed' }, 200 + n * 400)
  assert.equal(squeeze.complete, false, 'Closing is not a full open-close-open cycle')
  feed(squeeze, rest, 400 + n * 400)
  assert.equal(squeeze.count, n + 1)
  assert.equal(squeeze.complete, n === 2)
}
const noise = new RiceActionTracker('squeeze', 0)
feed(noise, rest, 0)
noise.update({ ...rest, grip: 'closed' }, 200)
noise.update(rest, 230)
assert.equal(noise.count, 0, 'Short noisy gesture cannot count')

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
feed(left, rest, 0); feed(left, { ...rest, right: true }, 200)
assert.equal(left.result({ ...cue, action: 'left' }).outcome, 'wrong')
const missing = new RiceActionTracker('right', 0)
feed(missing, rest, 0)
assert.equal(missing.result({ ...cue, action: 'right' }).outcome, 'missed')

assert.equal(RICE_CUES.length, 20)
for (const round of [1, 2]) for (const player of [1, 2]) {
  assert.equal(RICE_CUES.filter(c => c.round === round && c.player === player).length, 5)
}
assert.ok(RICE_CUES.slice(0, 10).filter(c => c.action === 'pound').every(c => c.player === 1))
assert.ok(RICE_CUES.slice(10).filter(c => c.action === 'pound').every(c => c.player === 2))
const aborted = { ...freshRiceResult(), trials: [{ ...cue, outcome: 'correct', reactionMs: 200, completionMs: 600 }] }
assert.equal(ricePlayerStats(aborted, 1).rating, 0, 'One successful action before abort is not a perfect score')
assert.equal(ricePlayerStats(freshRiceResult(), 1).rating, 0)
console.log('Game C: movement cycles, shared finishing pose, loss/noise, wrong/missed input, role balance, and partial results passed.')
