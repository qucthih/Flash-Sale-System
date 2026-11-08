import { Request, Response, NextFunction } from 'express';

interface CachedResponse {
  status: 'PENDING' | 'COMPLETED';
  statusCode?: number;
  body?: any;
  timestamp: number;
}

// Bộ nhớ đệm tạm thời cho Idempotency Key (trong thực tế production sẽ dùng Redis với TTL ~1-2 phút)
const idempotencyStore = new Map<string, CachedResponse>();

// Tự động dọn dẹp các key quá 5 phút
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of idempotencyStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      idempotencyStore.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Middleware chống đặt trùng đơn (Double-Submit / Replay Attack)
 * Header yêu cầu: `x-idempotency-key` (ví dụ: UUID ngẫu nhiên từ client)
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const idempotencyKey = req.headers['x-idempotency-key'] as string;

  // Nếu client không gửi header này, cho qua (optional hoặc bắt buộc tùy endpoint)
  if (!idempotencyKey) {
    return next();
  }

  const existing = idempotencyStore.get(idempotencyKey);

  if (existing) {
    if (existing.status === 'PENDING') {
      res.status(409).json({
        success: false,
        message: 'A request with this idempotency key is already in progress. Please wait.',
      });
      return;
    }

    if (existing.status === 'COMPLETED') {
      // Trả lại kết quả đã cache từ lần gọi thành công trước đó
      res.status(existing.statusCode || 200).json({
        ...existing.body,
        _cached: true,
        _idempotent: true,
      });
      return;
    }
  }

  // Đánh dấu key đang được xử lý (In-flight)
  idempotencyStore.set(idempotencyKey, {
    status: 'PENDING',
    timestamp: Date.now(),
  });

  // Intercept hàm res.json để lưu kết quả hoàn tất
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    idempotencyStore.set(idempotencyKey, {
      status: 'COMPLETED',
      statusCode: res.statusCode,
      body,
      timestamp: Date.now(),
    });
    return originalJson(body);
  };

  next();
}

