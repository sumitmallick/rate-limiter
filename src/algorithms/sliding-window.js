/**
 * Sliding Window Log
 * Exact per-user request log. Most accurate, O(n) memory per user.
 * Best for: strict fairness, small request volumes.
 */
export class SlidingWindowAlgorithm {
  name = 'sliding-window'

  // ── Memory ────────────────────────────────────────────────────────────────

  initState() {
    return [] // array of request timestamps
  }

  consume(timestamps, { limit, windowMs }, now) {
    const cutoff = now - windowMs
    let i = 0
    while (i < timestamps.length && timestamps[i] <= cutoff) i++
    if (i > 0) timestamps.splice(0, i)

    const resetAt = timestamps.length > 0 ? timestamps[0] + windowMs : now + windowMs

    if (timestamps.length >= limit) {
      return { allowed: false, remaining: 0, resetAt }
    }

    timestamps.push(now)
    return { allowed: true, remaining: limit - timestamps.length, resetAt }
  }

  buildStats(timestamps, { limit, windowMs }, now) {
    const cutoff = now - windowMs
    const active = timestamps.filter(ts => ts > cutoff)
    const resetAt = active.length > 0 ? active[0] + windowMs : now + windowMs
    return {
      current_window_count: active.length,
      remaining: Math.max(0, limit - active.length),
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }

  sweep(timestamps, { windowMs }, now) {
    const cutoff = now - windowMs
    let i = 0
    while (i < timestamps.length && timestamps[i] <= cutoff) i++
    if (i > 0) timestamps.splice(0, i)
  }

  // ── Redis ─────────────────────────────────────────────────────────────────

  redisKeys(userId) {
    return [`rl:sw:win:${userId}`, `rl:sw:stats:${userId}`, 'rl:users']
  }

  redisArgs({ limit, windowMs }, now, userId) {
    return [now, windowMs, limit, userId, `${now}-${Math.random().toString(36).slice(2)}`]
  }

  luaScript = `
local win_key   = KEYS[1]
local stats_key = KEYS[2]
local users_key = KEYS[3]
local now       = tonumber(ARGV[1])
local win_ms    = tonumber(ARGV[2])
local limit     = tonumber(ARGV[3])
local user_id   = ARGV[4]
local member    = ARGV[5]

redis.call('SADD', users_key, user_id)
redis.call('ZREMRANGEBYSCORE', win_key, 0, now - win_ms)

local count = tonumber(redis.call('ZCARD', win_key))

if count < limit then
  redis.call('ZADD', win_key, now, member)
  redis.call('PEXPIRE', win_key, win_ms + 1000)
  redis.call('HINCRBY', stats_key, 'allowed', 1)
  local oldest = redis.call('ZRANGEBYSCORE', win_key, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  return { 1, limit - count - 1, tonumber(oldest[2]) + win_ms }
else
  redis.call('HINCRBY', stats_key, 'rejected', 1)
  local oldest = redis.call('ZRANGEBYSCORE', win_key, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  return { 0, 0, tonumber(oldest[2]) + win_ms }
end
`

  async buildRedisStats(client, userId, { limit, windowMs }, now) {
    const cutoff = now - windowMs
    const [stats, activeCount, oldest] = await Promise.all([
      client.hgetall(`rl:sw:stats:${userId}`),
      client.zcount(`rl:sw:win:${userId}`, cutoff, '+inf'),
      client.zrangebyscore(`rl:sw:win:${userId}`, cutoff, '+inf', 'WITHSCORES', 'LIMIT', 0, 1),
    ])
    const resetAt = oldest.length > 1 ? parseFloat(oldest[1]) + windowMs : now + windowMs
    const allowed = parseInt(stats?.allowed ?? 0)
    const rejected = parseInt(stats?.rejected ?? 0)
    return {
      allowed, rejected,
      total: allowed + rejected,
      current_window_count: activeCount,
      remaining: Math.max(0, limit - activeCount),
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }
}
