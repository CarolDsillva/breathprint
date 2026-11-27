// @ts-check
/**
 * Small in-memory cache with a time-to-live and a size cap (least recently used is evicted).
 * Enough for one container; no external store needed.
 * @template V
 */
export class TtlCache {
  /**
   * @param {{ ttlMs: number, max: number, now?: () => number }} opts
   */
  constructor({ ttlMs, max, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    /** @type {Map<string, { value: V, expires: number }>} */
    this.map = new Map();
  }

  /** @param {string} key */
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  /**
   * @param {string} key
   * @param {V} value
   */
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

/**
 * Wrap an async loader so concurrent calls for the same key share one request and results are cached.
 * @template V
 * @param {TtlCache<V>} cache
 * @param {(key: string) => Promise<V>} load
 */
export function cached(cache, load) {
  /** @type {Map<string, Promise<V>>} */
  const inflight = new Map();
  /** @param {string} key */
  return async (key) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = load(key)
      .then((v) => {
        cache.set(key, v);
        return v;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
