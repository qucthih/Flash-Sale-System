import { Queue, JobsOptions } from 'bullmq';
import { bullMQConnection } from '../config/queue.config.js';

export interface OrderJobPayload {
  orderId: string;
  productId: string;
  userId: string;
  quantity: number;
  timestamp: number;
}

export interface DeadLetterJobPayload extends OrderJobPayload {
  failedReason: string;
  stacktrace?: string[];
  attemptsMade: number;
  failedAt: number;
}

export const ORDER_QUEUE_NAME = 'order-processing-queue';
export const ORDER_DLQ_NAME = 'order-dead-letter-queue';

/**
 * Cấu hình mặc định cho Order Job:
 * - attempts: 3 lần thử lại khi gặp lỗi DB / network
 * - backoff: exponential (1s -> 2s -> 4s)
 * - removeOnComplete: lưu lại 5000 job gần nhất để truy vết
 * - removeOnFail: giữ lại khi fail để không mất dấu vết
 */
export const defaultOrderJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    count: 5000,
    age: 24 * 3600, // 24 giờ
  },
  removeOnFail: false,
};

/**
 * BullMQ Queue chính nhận các đơn hàng đã trừ tồn kho Redis thành công
 */
export const orderQueue = new Queue<OrderJobPayload>(ORDER_QUEUE_NAME, {
  connection: bullMQConnection,
  defaultJobOptions: defaultOrderJobOptions,
});

/**
 * Dead Letter Queue (DLQ) chứa các đơn hàng thất bại vĩnh viễn sau khi đã retry hết số lần quy định
 */
export const orderDlqQueue = new Queue<DeadLetterJobPayload>(ORDER_DLQ_NAME, {
  connection: bullMQConnection,
});
