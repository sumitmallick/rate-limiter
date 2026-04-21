import Redis from 'ioredis'

const CONSUME_SCRIPT = `
local window_key  = KEYS[1]
local stats_key   = KEYS[2]
local users_key   = KEYS[3]
local now         = tonumber(ARGV[1])
local window_ms   = tonumber(ARGV[2])
local limit       = tonumber(ARGV[3])
local user_id     = ARGV[4]
local member      = ARGV[5]

redis.call('SADD', users_key, user_id)
redis.call('ZREMRANGEBYSCORE', window_key, 0, now - window_ms)

local count = tonumber(redis.call('ZCARD', window_key))

if count < limit then
  redis.call('ZADD', window_key, now, member)
  redis.call('PEXPIRE', window_key, window_ms + 1000)
  redis.call('HINCRBY', stats_key, 'allowed', 1)
  local oldest = redis.call('ZRANGEBYSCORE', window_key, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  local reset_at = tonumber(oldest[2]) + window_ms
  return { 1, limit - count - 1, reset_at }
else
  redis.call('HINCRBY', stats_key, 'rejected', 1)
  local oldest = redis.call('ZRANGEBYSCORE', window_key, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  local reset_at = tonumber(oldest[2]) + window_ms
  return { 0, 0, reset_at }
end
`

export class RedisStore {
  #client
  #limit
  #windowMs
  #scriptSha = null

  constructor({ limit, windowMs, url }) {
    this.#limit = limit
    this.#windowMs = windowMs
    this.#client = new Redis(url, { lazyConnect: true })
  }

  async connect() {
    await this.#client.connect()
    this.#scriptSha = await this.#client.script('LOAD', CONSUME_SCRIPT)
  }

  async consume(userId) {
    const now = Date.now()
    const member = `${now}-${Math.random().toString(36).slice(2)}`

    const keys = [
      `rl:window:${userId}`,
      `rl:stats:${userId}`,
      'rl:users',
    ]
    const args = [now, this.#windowMs, this.#limit, userId, member]

    let result
    try {
      result = await this.#client.evalsha(this.#scriptSha, keys.length, ...keys, ...args)
    } catch {
      result = await this.#client.eval(CONSUME_SCRIPT, keys.length, ...keys, ...args)
    }

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetAt: result[2],
    }
  }

  async getStats(userId) {
    if (userId) {
      if (!(await this.#client.sismember('rl:users', userId))) return {}
      return { [userId]: await this.#buildUserStats(userId) }
    }

    const users = await this.#client.smembers('rl:users')
    const result = {}
    await Promise.all(
      users.map(async uid => {
        result[uid] = await this.#buildUserStats(uid)
      })
    )
    return result
  }

  async #buildUserStats(userId) {
    const now = Date.now()
    const cutoff = now - this.#windowMs

    const [stats, activeCount, oldest] = await Promise.all([
      this.#client.hgetall(`rl:stats:${userId}`),
      this.#client.zcount(`rl:window:${userId}`, cutoff, '+inf'),
      this.#client.zrangebyscore(`rl:window:${userId}`, cutoff, '+inf', 'WITHSCORES', 'LIMIT', 0, 1),
    ])

    const resetAt = oldest.length > 1 ? parseFloat(oldest[1]) + this.#windowMs : now + this.#windowMs
    const allowed = parseInt(stats?.allowed ?? 0)
    const rejected = parseInt(stats?.rejected ?? 0)

    return {
      allowed,
      rejected,
      total: allowed + rejected,
      current_window_count: activeCount,
      remaining: Math.max(0, this.#limit - activeCount),
      window_resets_at: new Date(resetAt).toISOString(),
    }
  }

  async destroy() {
    await this.#client.quit()
  }
}
