export class MemoryStore {
  #algorithm
  #config
  #states = new Map()   // userId → algorithm-specific state
  #stats  = new Map()   // userId → { allowed, rejected }
  #sweepTimer

  constructor({ limit, windowMs, algorithm }) {
    this.#algorithm = algorithm
    this.#config    = { limit, windowMs }
    this.#sweepTimer = setInterval(() => this.#sweep(), windowMs * 2)
    this.#sweepTimer.unref()
  }

  consume(userId) {
    const now = Date.now()

    if (!this.#states.has(userId)) this.#states.set(userId, this.#algorithm.initState())
    if (!this.#stats.has(userId))  this.#stats.set(userId, { allowed: 0, rejected: 0 })

    const result = this.#algorithm.consume(this.#states.get(userId), this.#config, now)
    const counter = this.#stats.get(userId)

    if (result.allowed) counter.allowed++
    else counter.rejected++

    return result
  }

  getStats(userId) {
    if (userId) {
      if (!this.#stats.has(userId)) return {}
      return { [userId]: this.#buildUserStats(userId) }
    }

    const result = {}
    for (const uid of this.#stats.keys()) {
      result[uid] = this.#buildUserStats(uid)
    }
    return result
  }

  #buildUserStats(userId) {
    const now    = Date.now()
    const state  = this.#states.get(userId) ?? this.#algorithm.initState()
    const counter = this.#stats.get(userId) ?? { allowed: 0, rejected: 0 }
    const algoStats = this.#algorithm.buildStats(state, this.#config, now)
    return {
      allowed:  counter.allowed,
      rejected: counter.rejected,
      total:    counter.allowed + counter.rejected,
      ...algoStats,
    }
  }

  #sweep() {
    const now = Date.now()
    if (this.#algorithm.sweep) {
      for (const state of this.#states.values()) {
        this.#algorithm.sweep(state, this.#config, now)
      }
    }
  }

  destroy() {
    clearInterval(this.#sweepTimer)
  }
}
