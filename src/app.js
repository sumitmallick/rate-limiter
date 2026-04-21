import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import config from './config.js'
import { createStore } from './store/index.js'
import { requestRoutes } from './routes/request.js'
import { statsRoutes } from './routes/stats.js'

export async function buildApp(overrides = {}) {
  const resolvedConfig = { ...config, ...overrides }

  const fastify = Fastify({
    logger: {
      level: resolvedConfig.nodeEnv === 'test' ? 'silent' : 'info',
    },
  })

  await fastify.register(cors)

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Rate-Limited API Service',
        description:
          'Per-user sliding window rate limiter. Max 5 requests per user per minute by default.',
        version: '1.0.0',
      },
      tags: [
        { name: 'requests', description: 'Submit and process user requests' },
        { name: 'stats', description: 'Per-user rate limit statistics' },
        { name: 'system', description: 'Service health' },
      ],
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: false,
  })

  const store = await createStore(resolvedConfig)

  fastify.addHook('onClose', async () => store.destroy?.())

  fastify.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness probe',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              store: { type: 'string', enum: ['memory', 'redis'] },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      store: resolvedConfig.redis?.url ? 'redis' : 'memory',
    })
  )

  await fastify.register(requestRoutes, { store, config: resolvedConfig })
  await fastify.register(statsRoutes, { store })

  return fastify
}
