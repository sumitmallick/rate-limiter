import { SlidingWindowAlgorithm } from './sliding-window.js'
import { FixedWindowAlgorithm } from './fixed-window.js'
import { TokenBucketAlgorithm } from './token-bucket.js'
import { LeakyBucketAlgorithm } from './leaky-bucket.js'

const REGISTRY = {
  'sliding-window': SlidingWindowAlgorithm,
  'fixed-window':   FixedWindowAlgorithm,
  'token-bucket':   TokenBucketAlgorithm,
  'leaky-bucket':   LeakyBucketAlgorithm,
}

export const ALGORITHM_NAMES = Object.keys(REGISTRY)

export function createAlgorithm(name) {
  const key = name ?? 'sliding-window'
  const Cls = REGISTRY[key]
  if (!Cls) {
    throw new Error(`Unknown algorithm "${key}". Valid: ${ALGORITHM_NAMES.join(', ')}`)
  }
  return new Cls()
}
