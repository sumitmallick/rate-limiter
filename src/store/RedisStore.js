import Redis from 'ioredis'

export class RedisStore {
  #client
  #config
  #algorithm
  #scriptSha = null

  constructor({ limit, windowMs, url, algorithm }) {
    this.#config    = { limit, windowMs }
    this.#algorithm = algorithm
    this.#client    = new Redis(url, { lazyConnect: true })
  }

  async connect() {
    await this.#client.connect()
    this.#scriptSha = await this.#client.script('LOAD', this.#algorithm.luaScript)
  }

  async consume(userId) {
    const now  = Date.now()
    const keys = this.#algorithm.redisKeys(userId)
    const args = this.#algorithm.redisArgs(this.#config, now, userId)

    let result
    try {
      result = await this.#client.evalsha(this.#scriptSha, keys.length, ...keys, ...args)
    } catch {
      result = await this.#client.eval(this.#algorithm.luaScript, keys.length, ...keys, ...args)
    }

    return {
      allowed:   result[0] === 1,
      remaining: result[1],
      resetAt:   result[2],
    }
  }

  async getStats(userId) {
    const now = Date.now()

    if (userId) {
      if (!(await this.#client.sismember('rl:users', userId))) return {}
      return { [userId]: await this.#algorithm.buildRedisStats(this.#client, userId, this.#config, now) }
    }

    const users = await this.#client.smembers('rl:users')
    const result = {}
    await Promise.all(
      users.map(async uid => {
        result[uid] = await this.#algorithm.buildRedisStats(this.#client, uid, this.#config, now)
      })
    )
    return result
  }

  async destroy() {
    await this.#client.quit()
  }
}
