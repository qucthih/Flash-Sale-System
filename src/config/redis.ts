import { Redis, RedisOptions } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: 3,
  connectTimeout: 4000,
  commandTimeout: 3000,
  enableReadyCheck: true,
  lazyConnect: true, // Kết nối khi cần, tránh block khởi động server nếu Redis tạm thời chưa bật
  retryStrategy(times) {
    if (times > 5) {
      console.warn('⚠️ [Redis] Đã thử kết nối lại 5 lần không thành công.');
      return null; // Dừng retry
    }
    const delay = Math.min(times * 300, 2000);
    return delay;
  },
};

declare global {
  // eslint-disable-next-line no-var
  var redisClient: Redis | undefined;
}

export const redis: Redis =
  global.redisClient ||
  (process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, redisOptions)
    : new Redis(redisOptions));

if (process.env.NODE_ENV !== 'production') {
  global.redisClient = redis;
}

// Log các trạng thái kết nối
redis.on('connect', () => {
  console.log('🔌 [Redis] Đang kết nối tới Redis Server...');
});

redis.on('ready', () => {
  console.log('✅ [Redis] Đã kết nối và sẵn sàng xử lý tác vụ In-memory!');
});

redis.on('error', (err) => {
  // Bắt lỗi kết nối để tránh unhandled exception
  console.warn(`⚠️ [Redis Error]: ${err.message}`);
});

