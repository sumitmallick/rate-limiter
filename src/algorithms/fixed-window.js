/**
 * Fixed Window Counter
 * Simple counter that resets at the start of each fixed interval.
 * Best for: low-overhead counting, burst-tolerant use cases.
 * Trade-off: up to 2x burst at window boundaries.
 */
export class FixedWindowAlgorithm {
  name = 'fixed-window'

  // ── Memory ────────────────────────────────────────────────────────────────

  initState() {
    return { count: 0, windowStart: 0 }
  }

  consume(state, { limit, windowMs }, now) {
    if (now >= state.windowStart + windowMs) {
      state.count = 0
      state.windowStart = now
    }

    const resetAt = state.windowStart + windowMs

    if (state.count >= limit) {
      return { allowed: false, remaining: 0, resetAt }
    }

    state.count++
    return { allowed: true, remaining: limit - state.count, resetAt }
  }

  buildStats(state, { limit, windowMs }, now) {
    const activeCount = state.windowStart > 0 && now < state.windowStart + windowMs ? state.count : 0
    const resetAt = state.windowStart > 0 ? state.windowStart + windowMs : now + windowMs
    return {
      current_window_count: activeCount,
      remaining: Math.max(0, limit - activeCount),
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }

  // ── Redis ─────────────────────────────────────────────────────────────────

  redisKeys(userId) {
    return [`rl:fw:bucket:${userId}`, `rl:fw:stats:${userId}`, 'rl:users']
  }

  redisArgs({ limit, windowMs }, now, userId) {
    return [now, windowMs, limit, userId]
  }

  luaScript = `
local bucket_key = KEYS[1]
local stats_key  = KEYS[2]
local users_key  = KEYS[3]
local now        = tonumber(ARGV[1])
local win_ms     = tonumber(ARGV[2])
local limit      = tonumber(ARGV[3])
local user_id    = ARGV[4]

redis.call('SADD', users_key, user_id)

local data         = redis.call('HMGET', bucket_key, 'count', 'window_start')
local count        = tonumber(data[1]) or 0
local window_start = tonumber(data[2]) or 0

if now >= window_start + win_ms then
  count = 0
  window_start = now
end

local reset_at = window_start + win_ms

if count < limit then
  count = count + 1
  redis.call('HMSET', bucket_key, 'count', count, 'window_start', window_start)
  redis.call('PEXPIRE', bucket_key, win_ms + 1000)
  redis.call('HINCRBY', stats_key, 'allowed', 1)
  return { 1, limit - count, reset_at }
else
  redis.call('HINCRBY', stats_key, 'rejected', 1)
  return { 0, 0, reset_at }
end
`

  async buildRedisStats(client, userId, { limit, windowMs }, now) {
    const [stats, data] = await Promise.all([
      client.hgetall(`rl:fw:stats:${userId}`),
      client.hmget(`rl:fw:bucket:${userId}`, 'count', 'window_start'),
    ])
    const allowed = parseInt(stats?.allowed ?? 0)
    const rejected = parseInt(stats?.rejected ?? 0)
    const count = parseInt(data[0] ?? 0)
    const windowStart = parseFloat(data[1] ?? 0)
    const activeCount = windowStart > 0 && now < windowStart + windowMs ? count : 0
    const resetAt = windowStart > 0 ? windowStart + windowMs : now + windowMs
    return {
      allowed, rejected,
      total: allowed + rejected,
      current_window_count: activeCount,
      remaining: Math.max(0, limit - activeCount),
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }
}
