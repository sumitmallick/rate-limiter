import { ALGORITHM_NAMES } from './algorithms/index.js'

const env = (key, fallback) => process.env[key] ?? fallback

const algorithm = env('RATE_LIMIT_ALGORITHM', 'sliding-window')
if (!ALGORITHM_NAMES.includes(algorithm)) {
  throw new Error(`Invalid RATE_LIMIT_ALGORITHM "${algorithm}". Valid: ${ALGORITHM_NAMES.join(', ')}`)
}

export default {
  port:    parseInt(env('PORT', '3000')),
  nodeEnv: env('NODE_ENV', 'development'),
  rateLimit: {
    max:       parseInt(env('RATE_LIMIT_MAX', '5')),
    windowMs:  parseInt(env('RATE_LIMIT_WINDOW_MS', '60000')),
    algorithm,
  },
  redis: {
    url: env('REDIS_URL', ''),
  },
}
