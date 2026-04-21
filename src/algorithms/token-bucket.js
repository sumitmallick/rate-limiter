/**
 * Token Bucket
 * Bucket starts full (max tokens). Each request consumes 1 token.
 * Tokens refill continuously at rate = max / windowMs per ms.
 * Best for: smooth throughput, burst absorption up to bucket capacity.
 *
 * Config mapping:
 *   max       → bucket capacity (max burst size)
 *   windowMs  → full refill period (determines refill rate)
 */
export class TokenBucketAlgorithm {
  name = 'token-bucket'

  // ── Memory ────────────────────────────────────────────────────────────────

  initState() {
    return { tokens: null, lastRefill: 0 } // null = uninitialized (starts full on first consume)
  }

  consume(state, { limit, windowMs }, now) {
    const rate = limit / windowMs // tokens per ms

    if (state.tokens === null) {
      // First-ever request: bucket full, consume 1
      state.tokens = limit - 1
      state.lastRefill = now
      const resetAt = now + Math.ceil((limit - state.tokens) / rate)
      return { allowed: true, remaining: Math.floor(state.tokens), resetAt }
    }

    // Refill based on elapsed time
    const elapsed = now - state.lastRefill
    state.tokens = Math.min(limit, state.tokens + elapsed * rate)
    state.lastRefill = now

    if (state.tokens < 1) {
      const resetAt = now + Math.ceil((1 - state.tokens) / rate)
      return { allowed: false, remaining: 0, resetAt }
    }

    state.tokens -= 1
    const resetAt = now + Math.ceil((limit - state.tokens) / rate)
    return { allowed: true, remaining: Math.floor(state.tokens), resetAt }
  }

  buildStats(state, { limit, windowMs }, now) {
    const rate = limit / windowMs
    let tokens = state.tokens ?? limit
    if (state.lastRefill > 0) {
      tokens = Math.min(limit, tokens + (now - state.lastRefill) * rate)
    }
    const remaining = Math.floor(tokens)
    const resetAt = now + Math.ceil((limit - tokens) / rate)
    return {
      current_window_count: Math.max(0, limit - remaining), // tokens consumed
      remaining,
      window_resets_at: new Date(resetAt).toISOString(), // when bucket is full
    }
  }

  // ── Redis ─────────────────────────────────────────────────────────────────

  redisKeys(userId) {
    return [`rl:tb:bucket:${userId}`, `rl:tb:stats:${userId}`, 'rl:users']
  }

  redisArgs({ limit, windowMs }, now, userId) {
    return [now, windowMs, limit, userId]
  }

  luaScript = `
local bucket_key  = KEYS[1]
local stats_key   = KEYS[2]
local users_key   = KEYS[3]
local now         = tonumber(ARGV[1])
local win_ms      = tonumber(ARGV[2])
local limit       = tonumber(ARGV[3])
local user_id     = ARGV[4]

redis.call('SADD', users_key, user_id)

local data        = redis.call('HMGET', bucket_key, 'tokens', 'last_refill')
local tokens      = tonumber(data[1])
local last_refill = tonumber(data[2])

local rate = limit / win_ms

if tokens == nil then
  tokens = limit - 1
  last_refill = now
else
  local elapsed = now - last_refill
  tokens = math.min(limit, tokens + elapsed * rate)
  last_refill = now
end

if tokens < 1 then
  local reset_at = now + math.ceil((1 - tokens) / rate)
  redis.call('HMSET', bucket_key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('PEXPIRE', bucket_key, win_ms + 1000)
  redis.call('HINCRBY', stats_key, 'rejected', 1)
  return { 0, 0, reset_at }
else
  tokens = tokens - 1
  local reset_at = now + math.ceil((limit - tokens) / rate)
  redis.call('HMSET', bucket_key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('PEXPIRE', bucket_key, win_ms + 1000)
  redis.call('HINCRBY', stats_key, 'allowed', 1)
  return { 1, math.floor(tokens), reset_at }
end
`

  async buildRedisStats(client, userId, { limit, windowMs }, now) {
    const [stats, data] = await Promise.all([
      client.hgetall(`rl:tb:stats:${userId}`),
      client.hmget(`rl:tb:bucket:${userId}`, 'tokens', 'last_refill'),
    ])
    const allowed = parseInt(stats?.allowed ?? 0)
    const rejected = parseInt(stats?.rejected ?? 0)

    const rate = limit / windowMs
    let tokens = data[0] != null ? parseFloat(data[0]) : limit
    const lastRefill = data[1] != null ? parseFloat(data[1]) : now
    tokens = Math.min(limit, tokens + (now - lastRefill) * rate)

    const remaining = Math.floor(tokens)
    const resetAt = now + Math.ceil((limit - tokens) / rate)
    return {
      allowed, rejected,
      total: allowed + rejected,
      current_window_count: Math.max(0, limit - remaining),
      remaining,
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }
}
