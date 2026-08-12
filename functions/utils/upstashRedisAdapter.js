import { Redis } from '@upstash/redis';

const DEFAULT_PREFIX = 'imgbed:';

const globalBtoa = typeof btoa === 'function' ? btoa : (str) => Buffer.from(str, 'binary').toString('base64');
const globalAtob = typeof atob === 'function' ? atob : (str) => Buffer.from(str, 'base64').toString('binary');

function bufferToBase64(buffer) {
  if (buffer instanceof ArrayBuffer) {
    buffer = new Uint8Array(buffer);
  }
  if (ArrayBuffer.isView(buffer)) {
    buffer = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return globalBtoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = globalAtob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function serializeValue(value) {
  if (value === undefined || value === null) {
    return { storedValue: '', encoding: 'utf8' };
  }

  if (typeof value === 'string') {
    return { storedValue: value, encoding: 'utf8' };
  }

  if (typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    try {
      return { storedValue: JSON.stringify(value), encoding: 'json' };
    } catch (e) {
      return { storedValue: String(value), encoding: 'utf8' };
    }
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return {
      storedValue: bufferToBase64(value),
      encoding: 'base64',
    };
  }

  return { storedValue: String(value), encoding: 'utf8' };
}

function deserializeValue(storedValue, encoding, options = {}) {
  options = options || {};
  const type = options.type || '';

  if (encoding === 'base64') {
    if (type === 'text') {
      const buffer = base64ToArrayBuffer(storedValue);
      return new TextDecoder('utf-8').decode(buffer);
    }
    if (type === 'json') {
      const buffer = base64ToArrayBuffer(storedValue);
      const text = new TextDecoder('utf-8').decode(buffer);
      return JSON.parse(text);
    }
    return base64ToArrayBuffer(storedValue);
  }

  if (encoding === 'json') {
    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(storedValue).buffer;
    }
    if (type === 'json') {
      return JSON.parse(storedValue);
    }
    return storedValue;
  }

  if (encoding === 'utf8') {
    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(storedValue).buffer;
    }
    if (type === 'json') {
      return JSON.parse(storedValue);
    }
    return storedValue;
  }

  return storedValue;
}

export class UpstashKVAdapter {
  constructor(options = {}) {
    const config = typeof options === 'string'
      ? { url: options, token: process.env.UPSTASH_REDIS_REST_TOKEN }
      : options;

    const url = config.url || config.UPSTASH_REDIS_REST_URL || config.upstashRedisRestUrl || process.env.UPSTASH_REDIS_REST_URL;
    const token = config.token || config.UPSTASH_REDIS_REST_TOKEN || config.upstashRedisRestToken || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (config.redis && typeof config.redis.get === 'function') {
      this.redis = config.redis;
    } else if (url && token) {
      this.redis = new Redis({ url, token });
    } else {
      throw new Error('Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
    }

    this.prefix = config.prefix || DEFAULT_PREFIX;
  }

  getKey(key) {
    return `${this.prefix}${key}`;
  }

  async put(key, value, options = {}) {
    const redisKey = this.getKey(key);
    const metadata = JSON.stringify(options.metadata || {});
    const { storedValue, encoding } = serializeValue(value);

    await this.redis.hset(redisKey, {
      value: storedValue,
      metadata,
      encoding,
    });

    if (options.expiration || options.expirationTtl) {
      const expirationTs = options.expiration ? Number(options.expiration) : null;
      const ttl = options.expirationTtl ? Number(options.expirationTtl) : null;
      let expireSeconds = ttl;
      if (!expireSeconds && expirationTs) {
        const seconds = Math.floor((expirationTs - Date.now() / 1000));
        expireSeconds = seconds > 0 ? seconds : 0;
      }
      if (expireSeconds > 0) {
        await this.redis.expire(redisKey, expireSeconds);
      }
    }

    return true;
  }

  async get(key, options = {}) {
    const redisKey = this.getKey(key);
    const data = await this.redis.hgetall(redisKey);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    return deserializeValue(data.value || '', data.encoding || 'utf8', options);
  }

  async getWithMetadata(key, options = {}) {
    const redisKey = this.getKey(key);
    const data = await this.redis.hgetall(redisKey);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const metadata = data.metadata ? JSON.parse(data.metadata) : {};
    const value = deserializeValue(data.value || '', data.encoding || 'utf8', options);
    return { value, metadata };
  }

  async delete(key) {
    const redisKey = this.getKey(key);
    return await this.redis.del(redisKey);
  }

  async list(options = {}) {
    const prefix = options.prefix || '';
    const limit = Number.isFinite(options.limit) ? options.limit : 1000;
    const redisPattern = `${this.getKey(prefix)}*`;
    let cursor = options.cursor ? String(options.cursor) : '0';
    const keys = [];

    while (keys.length < limit) {
      const scanResult = await this.redis.scan(cursor, { match: redisPattern, count: Math.min(1000, limit - keys.length) });
      cursor = scanResult[0];
      const scannedKeys = scanResult[1] || [];

      for (const fullKey of scannedKeys) {
        const keyName = fullKey.slice(this.prefix.length);
        const metadataStr = await this.redis.hget(fullKey, 'metadata');
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};
        keys.push({ name: keyName, metadata });
        if (keys.length >= limit) {
          break;
        }
      }

      if (cursor === '0' || scannedKeys.length === 0) {
        break;
      }
    }

    return {
      keys,
      cursor: cursor === '0' ? null : cursor,
      list_complete: cursor === '0',
    };
  }
}
