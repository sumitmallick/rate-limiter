const querystringSchema = {
  type: 'object',
  properties: {
    user_id: { type: 'string', minLength: 1, maxLength: 256, description: 'Filter stats to a single user' },
  },
}

const userStatsSchema = {
  type: 'object',
  properties: {
    allowed: { type: 'integer', description: 'Total requests allowed all time' },
    rejected: { type: 'integer', description: 'Total requests rejected all time' },
    total: { type: 'integer', description: 'Total requests attempted all time' },
    current_window_count: { type: 'integer', description: 'Active requests in the current sliding window' },
    remaining: { type: 'integer', description: 'Slots remaining in the current window' },
    window_resets_at: { type: 'string', format: 'date-time', description: 'When the oldest window entry expires' },
  },
}

const responseSchema = {
  200: {
    description: 'Per-user request statistics',
    type: 'object',
    properties: {
      stats: {
        type: 'object',
        description: 'Map of user_id → stats. Empty object when no users match.',
        additionalProperties: userStatsSchema,
      },
    },
  },
}

export async function statsRoutes(fastify, { store }) {
  fastify.get(
    '/stats',
    {
      schema: {
        tags: ['stats'],
        summary: 'Get per-user request statistics',
        description:
          'Returns stats for all users, or a single user when `user_id` query param is provided.',
        querystring: querystringSchema,
        response: responseSchema,
      },
    },
    async req => {
      const stats = await store.getStats(req.query.user_id)
      return { stats }
    }
  )
}
