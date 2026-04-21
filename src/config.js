const env = (key, fallback) => process.env[key] ?? fallback

export default {
  port: parseInt(env('PORT', '3000')),
  nodeEnv: env('NODE_ENV', 'development'),
  rateLimit: {
    max: parseInt(env('RATE_LIMIT_MAX', '5')),
    windowMs: parseInt(env('RATE_LIMIT_WINDOW_MS', '60000')),
  },
  redis: {
    url: env('REDIS_URL', ''),
  },
}
