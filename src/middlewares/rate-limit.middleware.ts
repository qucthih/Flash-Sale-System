import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Dọn dẹp IP cũ sau mỗi 2 phút
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < 10000);
    if (record.timestamps.length === 0) {
      rateLimitStore.delete(ip);
    }
  }
}, 60 * 1000);

export interface RateLimitOptions {
  windowMs?: number; // Cửa sổ thời gian (default: 1000ms = 1s)
  maxRequests?: number; // Số request tối đa trong cửa sổ (default: 10)
}

/**
 * Middleware chống spam / DDoS flash sale theo IP (Sliding Window Algorithm)
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs || 1000;
  const maxRequests = options.maxRequests || 10;

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-client';
    const now = Date.now();

    let record = rateLimitStore.get(ip);
    if (!record) {
      record = { timestamps: [] };
      rateLimitStore.set(ip, record);
    }

    // Lọc các timestamp nằm trong window hiện tại
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

    if (record.timestamps.length >= maxRequests) {
      res.status(429).json({
        success: false,
        message: 'Too many requests. Flash Sale protection rate-limit exceeded. Please slow down.',
        retryAfterMs: windowMs - (now - record.timestamps[0]),
      });
      return;
    }

    record.timestamps.push(now);
    next();
  };
}

