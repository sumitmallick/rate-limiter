/**
 * Leaky Bucket
 * Queue drains at a fixed rate = max / windowMs per ms.
 * Requests fill the queue; if full, they are rejected.
 * Best for: enforcing a steady output rate, smoothing bursty traffic.
 *
 * Config mapping:
 *   max       → queue capacity
 *   windowMs  → time to fully drain a filled queue (determines leak rate)
 */
export class LeakyBucketAlgorithm {
  name = 'leaky-bucket'

  // ── Memory ────────────────────────────────────────────────────────────────

  initState() {
    return { queueCount: 0, lastLeak: 0 }
  }

  consume(state, { limit, windowMs }, now) {
    const rate = limit / windowMs // requests drain per ms

    if (state.lastLeak === 0) {
      state.lastLeak = now
    } else {
      const elapsed = now - state.lastLeak
      state.queueCount = Math.max(0, state.queueCount - elapsed * rate)
      state.lastLeak = now
    }

    // Time until next slot opens (1 request drains)
    const resetAt = now + Math.ceil(1 / rate)

    if (state.queueCount >= limit) {
      return { allowed: false, remaining: 0, resetAt }
    }

    state.queueCount += 1
    return { allowed: true, remaining: Math.floor(limit - state.queueCount), resetAt }
  }

  buildStats(state, { limit, windowMs }, now) {
    const rate = limit / windowMs
    let queue = state.queueCount
    if (state.lastLeak > 0) {
      queue = Math.max(0, queue - (now - state.lastLeak) * rate)
    }
    const currentCount = Math.ceil(queue)
    const remaining = Math.max(0, limit - currentCount)
    const resetAt = queue > 0 ? now + Math.ceil(queue / rate) : now + Math.ceil(1 / rate)
    return {
      current_window_count: currentCount, // queue depth
      remaining,
      window_resets_at: new Date(resetAt).toISOString(), // when queue fully drains
    }
  }

  // ── Redis ─────────────────────────────────────────────────────────────────

  redisKeys(userId) {
    return [`rl:lb:bucket:${userId}`, `rl:lb:stats:${userId}`, 'rl:users']
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

local data      = redis.call('HMGET', bucket_key, 'queue', 'last_leak')
local queue     = tonumber(data[1]) or 0
local last_leak = tonumber(data[2]) or now

local rate    = limit / win_ms
local elapsed = now - last_leak
queue     = math.max(0, queue - elapsed * rate)
last_leak = now

local reset_at = now + math.ceil(1 / rate)

if queue >= limit then
  redis.call('HMSET', bucket_key, 'queue', queue, 'last_leak', last_leak)
  redis.call('PEXPIRE', bucket_key, win_ms + 1000)
  redis.call('HINCRBY', stats_key, 'rejected', 1)
  return { 0, 0, reset_at }
else
  queue = queue + 1
  redis.call('HMSET', bucket_key, 'queue', queue, 'last_leak', last_leak)
  redis.call('PEXPIRE', bucket_key, win_ms + 1000)
  redis.call('HINCRBY', stats_key, 'allowed', 1)
  return { 1, math.floor(limit - queue), reset_at }
end
`

  async buildRedisStats(client, userId, { limit, windowMs }, now) {
    const [stats, data] = await Promise.all([
      client.hgetall(`rl:lb:stats:${userId}`),
      client.hmget(`rl:lb:bucket:${userId}`, 'queue', 'last_leak'),
    ])
    const allowed = parseInt(stats?.allowed ?? 0)
    const rejected = parseInt(stats?.rejected ?? 0)

    const rate = limit / windowMs
    let queue = data[0] != null ? parseFloat(data[0]) : 0
    const lastLeak = data[1] != null ? parseFloat(data[1]) : now
    queue = Math.max(0, queue - (now - lastLeak) * rate)

    const currentCount = Math.ceil(queue)
    const remaining = Math.max(0, limit - currentCount)
    const resetAt = queue > 0 ? now + Math.ceil(queue / rate) : now + Math.ceil(1 / rate)
    return {
      allowed, rejected,
      total: allowed + rejected,
      current_window_count: currentCount,
      remaining,
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }
}
