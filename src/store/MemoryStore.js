export class MemoryStore {
  #windows = new Map()
  #stats = new Map()
  #limit
  #windowMs
  #sweepTimer

  constructor({ limit, windowMs }) {
    this.#limit = limit
    this.#windowMs = windowMs
    this.#sweepTimer = setInterval(() => this.#sweep(), windowMs * 2)
    this.#sweepTimer.unref()
  }

  consume(userId) {
    const now = Date.now()
    const cutoff = now - this.#windowMs

    if (!this.#windows.has(userId)) this.#windows.set(userId, [])
    if (!this.#stats.has(userId)) this.#stats.set(userId, { allowed: 0, rejected: 0 })

    const window = this.#windows.get(userId)
    const stats = this.#stats.get(userId)

    let stale = 0
    while (stale < window.length && window[stale] <= cutoff) stale++
    if (stale > 0) window.splice(0, stale)

    const resetAt = window.length > 0 ? window[0] + this.#windowMs : now + this.#windowMs

    if (window.length >= this.#limit) {
      stats.rejected++
      return { allowed: false, remaining: 0, resetAt }
    }

    window.push(now)
    stats.allowed++

    return {
      allowed: true,
      remaining: this.#limit - window.length,
      resetAt,
    }
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
    const now = Date.now()
    const cutoff = now - this.#windowMs
    const window = this.#windows.get(userId) ?? []
    const stats = this.#stats.get(userId) ?? { allowed: 0, rejected: 0 }
    const active = window.filter(ts => ts > cutoff)
    const resetAt = active.length > 0 ? active[0] + this.#windowMs : now + this.#windowMs

    return {
      allowed: stats.allowed,
      rejected: stats.rejected,
      total: stats.allowed + stats.rejected,
      current_window_count: active.length,
      remaining: Math.max(0, this.#limit - active.length),
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }

  #sweep() {
    const cutoff = Date.now() - this.#windowMs
    for (const window of this.#windows.values()) {
      let stale = 0
      while (stale < window.length && window[stale] <= cutoff) stale++
      if (stale > 0) window.splice(0, stale)
    }
  }

  destroy() {
    clearInterval(this.#sweepTimer)
  }
}
