import { MemoryStore } from './MemoryStore.js'

export async function createStore({ rateLimit, redis }) {
  if (redis.url) {
    const { RedisStore } = await import('./RedisStore.js')
    const store = new RedisStore({ limit: rateLimit.max, windowMs: rateLimit.windowMs, url: redis.url })
    await store.connect()
    return store
  }

  return new MemoryStore({ limit: rateLimit.max, windowMs: rateLimit.windowMs })
}
