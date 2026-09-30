/** Active game time: pausing preserves every pending deadline without replaying a stage. */
export class GameClock {
  private offset = 0
  private frozenAt: number | null = null
  private nextId = 0
  private jobs = new Map<number, { at: number; interval: number; run: () => void; timer: number }>()
  private pauseListeners = new Set<() => void>()
  private resumeListeners = new Set<() => void>()
  get paused() { return this.frozenAt !== null }
  now = () => (this.frozenAt ?? performance.now()) - this.offset
  setTimeout = (run: () => void, ms = 0) => this.schedule(run, ms, 0)
  setInterval = (run: () => void, ms: number) => this.schedule(run, ms, Math.max(1, ms))
  clearTimeout = (id: number) => {
    const job = this.jobs.get(id)
    if (job) window.clearTimeout(job.timer)
    this.jobs.delete(id)
  }
  clearInterval = this.clearTimeout
  onPause(fn: () => void) { this.pauseListeners.add(fn); return () => { this.pauseListeners.delete(fn) } }
  onResume(fn: () => void) { this.resumeListeners.add(fn); return () => { this.resumeListeners.delete(fn) } }
  pause() {
    if (this.paused) return
    this.frozenAt = performance.now()
    for (const job of this.jobs.values()) window.clearTimeout(job.timer)
    this.pauseListeners.forEach(fn => fn())
  }
  resume() {
    if (this.frozenAt === null) return
    this.offset += performance.now() - this.frozenAt
    this.frozenAt = null
    this.resumeListeners.forEach(fn => fn())
    for (const id of this.jobs.keys()) this.arm(id)
  }
  dispose() {
    for (const id of this.jobs.keys()) this.clearTimeout(id)
    this.pauseListeners.clear()
    this.resumeListeners.clear()
    this.resume()
  }
  private schedule(run: () => void, ms: number, interval: number) {
    const id = ++this.nextId
    this.jobs.set(id, { at: this.now() + Math.max(0, ms), interval, run, timer: 0 })
    this.arm(id)
    return id
  }
  private arm(id: number) {
    const job = this.jobs.get(id)
    if (!job || this.paused) return
    window.clearTimeout(job.timer)
    job.timer = window.setTimeout(() => {
      if (this.paused || !this.jobs.has(id)) return
      if (!job.interval) this.jobs.delete(id)
      else job.at = this.now() + job.interval
      job.run()
      if (job.interval) this.arm(id)
    }, Math.max(0, job.at - this.now()))
  }
}
