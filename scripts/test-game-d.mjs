import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function load(file, deps = {}) {
  const source = readFileSync(new URL('../src/game/' + file + '.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: id => deps[id], Date, Math, Set })
  return exports
}
const catalog = load('gameDCatalog')
const { SHOPPING_PRODUCTS } = catalog
const { ShoppingSession, ShoppingGripTracker, createShoppingList,
  availableFor, shoppingStats, GAME_D_RULES } = load('gameD', { './gameDCatalog': catalog, './handGrip': load('handGrip') })
let groups = 0
const test = (name, run) => { run(); groups++; console.log('PASS ' + name) }
const cycle = (tracker, at) => {
  assert.equal(tracker.update('open', at), false)
  assert.equal(tracker.update('open', at + 100), false)
  assert.equal(tracker.update('closed', at + 200), false)
  return tracker.update('closed', at + 300)
}
test('Closing counts once; reopening is required; noise, stale poses and partial hands cannot score', () => {
  const t = new ShoppingGripTracker()
  t.update('closed', 0)
  assert.equal(t.update('closed', 500), false, 'Initially held fists are not a new gesture')
  assert.equal(cycle(t, 600), true, 'Counts on closing, not reopening')
  assert.equal(t.update('closed', 2500), false)
  assert.equal(t.update('closing', 2600), false)
  assert.equal(t.update('closed', 2700), false)
  assert.equal(t.update('closed', 2800), false, 'Half-opening does not rearm')
  assert.equal(cycle(t, 3000), true)
  t.update('open', 3400); t.update('open', 3500); t.update('closed', 3600)
  t.update('open', 3650)
  assert.equal(t.update('open', 3900), false, '50 ms noise never emits')
  t.update('unknown', 4000); t.update('closed', 4100)
  assert.equal(t.update('closed', 4300), false, 'Reacquiring a fist cannot score')
  t.reset()
  assert.equal(cycle(t, 4400), true)
})
test('One player crop requires a complete hand pair without reassigning hands by wrist position', () => {
  const { classifyPlayerHands } = load('handGrip')
  const sample = (xs, names) => ({ landmarks: xs.map(x => Array.from({ length: 21 }, (_, i) => ({ x, y: .6 - i * .003 }))),
    gestures: names.map(categoryName => [{ categoryName, score: .9 }]) })
  assert.equal(classifyPlayerHands(sample([.8, .1], ['Closed_Fist', 'Closed_Fist'])), 'closed')
  assert.equal(classifyPlayerHands(sample([.8, .7], ['Closed_Fist', 'Open_Palm'])), 'closing')
  assert.equal(classifyPlayerHands(sample([.01, .99], ['Open_Palm', 'Open_Palm'])), 'open')
  assert.equal(classifyPlayerHands(sample([.8], ['Closed_Fist'])), 'unknown')
  const low = sample([.8, .7], ['Closed_Fist', 'Closed_Fist']); low.gestures[0][0].score = .2
  assert.notEqual(classifyPlayerHands(low), 'closed')
  assert.equal(classifyPlayerHands(sample([], [])), 'unknown')
})
test('All levels have reachable lists; left/right-only products never cross lanes', () => {
  for (const level of [1, 2, 3]) for (let n = 0; n < 30; n++) {
    const list = createShoppingList(level)
    assert.equal(list.length, [0, 3, 5, 7][level])
    assert.equal(new Set(list.map(t => t.product)).size, list.length)
    assert.ok(list.some(t => shoppingSide(t.product) === 'left'))
    assert.ok(list.some(t => shoppingSide(t.product) === 'right'))
    assert.ok(list.every(t => t.required >= 2 && t.required <= 5 && t.collected === 0))
    const s = new ShoppingSession(level)
    for (let i = 0; i < 120; i++) {
      s.advance(1000)
      assert.ok(s.items.every(item => availableFor(item.product, item.player)))
    }
  }
})
function shoppingSide(id) { return SHOPPING_PRODUCTS.find(p => p.id === id).side }
function fixture(required = 2) {
  return new ShoppingSession(1, () => 0, [{ product: 'apple', required, collected: 0 }, { product: 'milk', required: 1, collected: 0 }])
}
function put(s, pid, product, id, y = 900) {
  s.items.push({ id, player: pid, product, y, enteredAt: y >= 844 ? s.elapsedMs : null, missed: false })
}
test('Shared quantities add once per item; outside-list and excess items never alter counts', () => {
  const s = fixture()
  s.items = []
  put(s, 1, 'apple', 501); put(s, 2, 'apple', 502)
  assert.equal(s.pick(1).outcome, 'correct')
  assert.equal(s.pick(1).outcome, 'empty', 'A consumed item cannot be scored twice')
  assert.equal(s.pick(2).outcome, 'correct')
  assert.equal(s.targets[0].collected, 2)
  put(s, 1, 'apple', 503)
  assert.equal(s.pick(1).reason, 'already-complete')
  put(s, 2, 'beef', 504)
  assert.equal(s.pick(2).reason, 'not-listed')
  assert.equal(s.targets[0].collected, 2)
  put(s, 1, 'milk', 505)
  assert.equal(s.pick(1).outcome, 'correct')
  assert.equal(s.reason, 'success')
  assert.equal(s.pick(2), null, 'Finished sessions reject input')
})
test('Target zones, misses and response times use simulation time, not render frame count', () => {
  const s = fixture()
  s.items = []
  put(s, 1, 'apple', 601, 820)
  assert.equal(s.pick(1).outcome, 'empty')
  s.advance(1000)
  const event = s.pick(1)
  assert.equal(event.outcome, 'correct')
  assert.equal(event.reactionMs, Math.round(1000 - 24 / 85 * 1000))
  put(s, 2, 'apple', 602, 1050)
  s.advance(1000)
  assert.equal(s.events.filter(e => e.outcome === 'missed' && e.itemId === 602).length, 1)
  s.advance(1000)
  assert.equal(s.events.filter(e => e.outcome === 'missed' && e.itemId === 602).length, 1)
  put(s, 2, 'beef', 603, 1050)
  s.advance(1000)
  assert.equal(s.events.filter(e => e.outcome === 'missed' && e.itemId === 603).length, 0)
})
test('Timeout rejects late input, abort preserves counts and exported results are snapshots', () => {
  const s = fixture()
  s.advance(120000)
  assert.equal(s.elapsedMs, 120000)
  assert.equal(s.reason, 'timeout')
  assert.equal(s.pick(1), null)
  s.advance(5000); assert.equal(s.elapsedMs, 120000)
  const a = fixture()
  a.noteMode('keyboard')
  a.items = []; put(a, 1, 'apple', 701)
  a.pick(1); a.advance(1500)
  const result = a.finish('aborted')
  assert.equal(result.reason, 'aborted')
  assert.equal(result.targets[0].collected, 1)
  result.targets[0].collected = 900
  assert.equal(a.targets[0].collected, 1)
  const empty = shoppingStats(fixture().finish('aborted'))
  assert.equal(empty.accuracy, null)
  assert.equal(empty.reactionMs, null)
})
test('Participant statistics stay separate; accuracy includes empty attempts', () => {
  const s = fixture(3)
  s.items = []; put(s, 1, 'apple', 801); put(s, 2, 'apple', 802)
  s.pick(1); s.pick(2); s.pick(1)
  put(s, 2, 'beef', 803); s.pick(2)
  const r = s.finish('aborted'), p1 = shoppingStats(r, 1), p2 = shoppingStats(r, 2), team = shoppingStats(r)
  assert.equal(p1.correct, 1); assert.equal(p1.empty, 1); assert.equal(p1.wrong, 0)
  assert.equal(p2.correct, 1); assert.equal(p2.wrong, 1)
  assert.equal(team.accuracy, 50)
  assert.equal(p1.contribution, 50)
  assert.equal(p2.contribution, 50)
  const uneven = { ...r, events: Array.from({length:8},(_,i)=>({
    player:i<3?1:2,outcome:'correct',reactionMs:200,
  })) }
  assert.equal(shoppingStats(uneven,1).contribution + shoppingStats(uneven,2).contribution,100,
    'Rounded participant shares must still add up to 100%')
})
test('Pacing supplies enough needed products to complete all three levels within 120 seconds', () => {
  for (const level of [1, 2, 3]) for (let seed = 1; seed <= 40; seed++) {
    let state = seed
    const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296)
    const s = new ShoppingSession(level, random)
    while (!s.reason) {
      for (const pid of [1, 2]) {
        const item = s.items.find(i => i.player === pid && i.y >= 844 && i.y <= 1053)
        if (item && s.targets.some(t => t.product === item.product && t.collected < t.required)) s.pick(pid)
      }
      s.advance(100)
    }
    assert.equal(s.reason, 'success', 'No target may be starved at level ' + level + ', seed ' + seed)
  }
})
test('Rehearsal holds each lane for its participant and never counts an early or extra grip', () => {
  const { ShoppingPractice } = load('gameDPractice', { './gameD': { GAME_D_RULES } })
  const practice = new ShoppingPractice()
  practice.advance(120000)
  assert.equal(practice.items.find(item => item.player === 2).y, 940, 'The other participant can take their time')
  assert.ok(practice.pick(1))
  assert.equal(practice.pick(1), null, 'Second apple is still approaching')
  practice.advance(1000)
  assert.equal(practice.pick(1), null)
  practice.advance(3000)
  assert.ok(practice.pick(1))
  assert.equal(practice.pick(1), null, 'Completed lanes cannot add extra items')
  assert.equal(practice.collected[1], 2)
  assert.equal(practice.collected[2], 0)
  assert.ok(practice.pick(2))
  practice.advance(4000)
  assert.ok(practice.pick(2))
  assert.equal(practice.targets[0].collected, 4)
  assert.equal(practice.items.length, 0)
})
console.log('Game D: ' + groups + ' regression groups passed.')
