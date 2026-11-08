import { ConnectionOptions } from 'bullmq';

/**
 * Cấu hình kết nối Redis dành riêng cho BullMQ.
 * QUAN TRỌNG: BullMQ yêu cầu `maxRetriesPerRequest: null` và `enableReadyCheck: false`.
 */
export const getBullMQConnectionOptions = (): ConnectionOptions => {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      return {
        host: parsed.hostname || '127.0.0.1',
        port: parsed.port ? Number(parsed.port) : 6379,
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      };
    } catch (err) {
      console.warn('⚠️ [BullMQ] Không thể parse REDIS_URL, dùng cấu hình mặc định localhost.');
    }
  }

  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
};

export const bullMQConnection: ConnectionOptions = getBullMQConnectionOptions();
