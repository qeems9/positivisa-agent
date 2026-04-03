const { Redis } = require("@upstash/redis");

let _redis = null;

function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return _redis;
}

// Mimic @vercel/kv interface
const kv = {
  async get(key) {
    return getRedis().get(key);
  },
  async set(key, value, options) {
    if (options?.ex) {
      return getRedis().set(key, value, { ex: options.ex });
    }
    return getRedis().set(key, value);
  },
  async del(key) {
    return getRedis().del(key);
  },
  async zadd(key, member) {
    return getRedis().zadd(key, member);
  },
  async zrange(key, start, stop, options) {
    return getRedis().zrange(key, start, stop, options);
  },
  async zcard(key) {
    return getRedis().zcard(key);
  },
};

module.exports = { kv };
