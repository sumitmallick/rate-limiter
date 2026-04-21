import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'

const TEST_CONFIG = {
  nodeEnv: 'test',
  rateLimit: { max: 5, windowMs: 60_000 },
  redis: { url: '' },
}

describe('Health', () => {
  let app

  before(async () => { app = await buildApp(TEST_CONFIG) })
  after(async () => { await app.close() })

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().status, 'ok')
  })
})

describe('POST /request', () => {
  let app

  before(async () => { app = await buildApp(TEST_CONFIG) })
  after(async () => { await app.close() })

  it('accepts valid request and returns 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { user_id: 'alice', payload: { action: 'search' } },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.success, true)
    assert.equal(body.user_id, 'alice')
    assert.ok(body.processed_at)
    assert.equal(body.remaining, 4)
  })

  it('returns 400 when user_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { payload: {} },
    })
    assert.equal(res.statusCode, 400)
  })

  it('returns 400 when payload is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { user_id: 'alice' },
    })
    assert.equal(res.statusCode, 400)
  })

  it('sets rate limit headers on allowed response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { user_id: 'header-test', payload: {} },
    })
    assert.ok(res.headers['x-ratelimit-limit'])
    assert.ok(res.headers['x-ratelimit-remaining'])
    assert.ok(res.headers['x-ratelimit-reset'])
  })

  it('accepts any valid JSON type as payload', async () => {
    const payloads = [{ key: 'val' }, [1, 2, 3], 'string-payload', 42, true]
    for (const payload of payloads) {
      const res = await app.inject({
        method: 'POST',
        url: '/request',
        payload: { user_id: 'payload-type-test', payload },
      })
      assert.equal(res.statusCode, 200, `failed for payload: ${JSON.stringify(payload)}`)
    }
  })
})

describe('Rate Limiting', () => {
  let app

  before(async () => { app = await buildApp(TEST_CONFIG) })
  after(async () => { await app.close() })

  it('allows exactly max requests then rejects', async () => {
    const userId = `user-limit-${Date.now()}`

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/request',
        payload: { user_id: userId, payload: {} },
      })
      assert.equal(res.statusCode, 200, `request ${i + 1} should be allowed`)
      assert.equal(res.json().remaining, 4 - i)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { user_id: userId, payload: {} },
    })
    assert.equal(blocked.statusCode, 429)

    const body = blocked.json()
    assert.equal(body.error, 'Too Many Requests')
    assert.ok(typeof body.retry_after === 'number')
    assert.ok(body.retry_after > 0)
    assert.equal(blocked.headers['x-ratelimit-remaining'], '0')
  })

  it('limits are per-user — one user hitting limit does not affect another', async () => {
    const base = Date.now()
    const userA = `user-a-${base}`
    const userB = `user-b-${base}`

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/request',
        payload: { user_id: userA, payload: {} },
      })
    }

    const res = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { user_id: userB, payload: {} },
    })
    assert.equal(res.statusCode, 200, 'user B should not be affected by user A hitting the limit')
  })

  it('concurrent requests from same user stay within limit', async () => {
    const userId = `user-concurrent-${Date.now()}`

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/request',
          payload: { user_id: userId, payload: {} },
        })
      )
    )

    const allowed = results.filter(r => r.statusCode === 200).length
    const rejected = results.filter(r => r.statusCode === 429).length

    assert.equal(allowed, 5)
    assert.equal(rejected, 0)

    const overflow = await app.inject({
      method: 'POST',
      url: '/request',
      payload: { user_id: userId, payload: {} },
    })
    assert.equal(overflow.statusCode, 429)
  })

  it('7 concurrent requests allow exactly 5 and reject 2', async () => {
    const userId = `user-overflow-${Date.now()}`

    const results = await Promise.all(
      Array.from({ length: 7 }, () =>
        app.inject({
          method: 'POST',
          url: '/request',
          payload: { user_id: userId, payload: {} },
        })
      )
    )

    const allowed = results.filter(r => r.statusCode === 200).length
    const rejected = results.filter(r => r.statusCode === 429).length

    assert.equal(allowed, 5)
    assert.equal(rejected, 2)
  })
})

describe('GET /stats', () => {
  let app

  before(async () => { app = await buildApp(TEST_CONFIG) })
  after(async () => { await app.close() })

  it('returns empty stats object when no users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats' })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json().stats, {})
  })

  it('tracks allowed and rejected counts accurately', async () => {
    const userId = `stats-test-${Date.now()}`

    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: 'POST',
        url: '/request',
        payload: { user_id: userId, payload: {} },
      })
    }

    const res = await app.inject({ method: 'GET', url: `/stats?user_id=${userId}` })
    assert.equal(res.statusCode, 200)

    const userStats = res.json().stats[userId]
    assert.equal(userStats.allowed, 5)
    assert.equal(userStats.rejected, 1)
    assert.equal(userStats.total, 6)
    assert.equal(userStats.current_window_count, 5)
    assert.equal(userStats.remaining, 0)
    assert.ok(userStats.window_resets_at)
  })

  it('returns empty stats for unknown user', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats?user_id=nobody-${Date.now()}' })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json().stats, {})
  })

  it('returns stats for all users when no query param', async () => {
    const base = Date.now()
    const users = [`multi-a-${base}`, `multi-b-${base}`]

    for (const uid of users) {
      await app.inject({
        method: 'POST',
        url: '/request',
        payload: { user_id: uid, payload: {} },
      })
    }

    const res = await app.inject({ method: 'GET', url: '/stats' })
    assert.equal(res.statusCode, 200)

    const stats = res.json().stats
    for (const uid of users) {
      assert.ok(stats[uid], `stats for ${uid} should be present`)
      assert.equal(stats[uid].total, 1)
    }
  })
})
