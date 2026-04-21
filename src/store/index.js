import { MemoryStore } from './MemoryStore.js'
import { createAlgorithm } from '../algorithms/index.js'

export async function createStore({ rateLimit, redis }) {
  const algorithm = createAlgorithm(rateLimit.algorithm)
  const { max: limit, windowMs } = rateLimit

  if (redis.url) {
    const { RedisStore } = await import('./RedisStore.js')
    const store = new RedisStore({ limit, windowMs, url: redis.url, algorithm })
    await store.connect()
    return store
  }

  return new MemoryStore({ limit, windowMs, algorithm })
}
