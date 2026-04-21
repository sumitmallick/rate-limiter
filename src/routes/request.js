const bodySchema = {
  type: 'object',
  required: ['user_id', 'payload'],
  properties: {
    user_id: { type: 'string', minLength: 1, maxLength: 256, description: 'Unique user identifier' },
    payload: { description: 'Any valid JSON value to be processed' },
  },
  additionalProperties: false,
}

const responseSchemas = {
  200: {
    description: 'Request accepted and processed',
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      user_id: { type: 'string' },
      processed_at: { type: 'string', format: 'date-time' },
      remaining: { type: 'integer', description: 'Requests remaining in current window' },
    },
  },
  400: {
    description: 'Invalid request body',
    type: 'object',
    properties: {
      statusCode: { type: 'integer' },
      error: { type: 'string' },
      message: { type: 'string' },
    },
  },
  429: {
    description: 'Rate limit exceeded',
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      retry_after: { type: 'integer', description: 'Seconds until the oldest window entry expires' },
    },
  },
}

export async function requestRoutes(fastify, { store, config }) {
  fastify.post(
    '/request',
    {
      schema: {
        tags: ['requests'],
        summary: 'Submit a user request',
        description:
          'Processes the request if the user is within their rate limit. Returns 429 when the limit is exceeded.',
        body: bodySchema,
        response: responseSchemas,
      },
    },
    async (req, reply) => {
      const { user_id } = req.body
      const result = await store.consume(user_id)

      reply.header('X-RateLimit-Limit', config.rateLimit.max)
      reply.header('X-RateLimit-Remaining', result.remaining)
      reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000))

      if (!result.allowed) {
        return reply.code(429).send({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Max ${config.rateLimit.max} requests per minute.`,
          retry_after: Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000)),
        })
      }

      return {
        success: true,
        user_id,
        processed_at: new Date().toISOString(),
        remaining: result.remaining,
      }
    }
  )
}
