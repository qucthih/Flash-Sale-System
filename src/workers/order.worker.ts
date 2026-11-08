import { Worker, Job } from 'bullmq';
import { prisma } from '../config/db.js';
import { bullMQConnection } from '../config/queue.config.js';
import {
  ORDER_QUEUE_NAME,
  orderDlqQueue,
  OrderJobPayload,
} from '../queues/order.queue.js';
import { flashSaleInventoryService } from '../services/flash-sale-inventory.service.js';

/**
 * Cấu hình Concurrency cho Worker:
 * Giá trị mặc định là 10.
 *
 * GIẢI THÍCH KIẾN TRÚC PHÂN TÁN (Distributed Systems Perspective):
 * - Database Connection Pool Boundary: Prisma và PostgreSQL thường cấp phát pool size từ 10 - 20 connections.
 * - Nếu đặt Concurrency quá cao (ví dụ 50 - 100), Worker sẽ cạnh tranh kết nối DB gay gắt dẫn đến lỗi
 *   "Timed out fetching a connection from the pool" (Prisma P2024), làm giảm thông lượng (Throughput Degrade).
 * - Concurrency 10 - 20 là con số "sweet spot" đảm bảo tận dụng tối đa I/O pipeline mà không làm bão hòa DB.
 */
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '10', 10);

/**
 * Xử lý từng đơn hàng từ Queue:
 * - Đảm bảo tính Idempotent (chống trùng lặp khi retry)
 * - Cập nhật Eventual Consistency giữa Redis và PostgreSQL
 */
export async function processOrderJob(job: Job<OrderJobPayload>): Promise<{ success: boolean; orderId: string }> {
  const { orderId, productId, userId, quantity } = job.data;

  console.log(`⏳ [OrderWorker] Đang xử lý Job ${job.id} (Attempt ${job.attemptsMade + 1}/${job.opts.attempts}): Order ${orderId}`);

  // 1. Idempotency Check: Nếu đơn hàng đã tồn tại trong DB, không xử lý lại
  const existingOrder = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (existingOrder) {
    console.warn(`⚠️ [OrderWorker] Order ${orderId} đã tồn tại trong DB. Bỏ qua bước tạo mới (Idempotent bypass).`);
    return { success: true, orderId };
  }

  // 2. Thực thi Transaction đảm bảo Eventual Consistency trên PostgreSQL
  await prisma.$transaction(async (tx) => {
    // a. Đồng bộ trừ trường stock tương ứng trong bảng Product của DB
    const updatedProduct = await tx.product.update({
      where: { id: productId },
      data: {
        stock: { decrement: quantity },
      },
    });

    // b. Ghi bản ghi vào bảng Order trong PostgreSQL
    await tx.order.create({
      data: {
        id: orderId,
        productId,
        userId: userId || null,
        quantity,
        status: 'SUCCESS',
      },
    });

    console.log(
      `✅ [OrderWorker] Đơn hàng ${orderId} đã lưu DB thành công! Tồn kho DB hiện tại của SP [${productId}]: ${updatedProduct.stock}`
    );
  });

  return { success: true, orderId };
}

/**
 * Khởi tạo BullMQ Worker lắng nghe queue 'order-processing-queue'
 */
export const orderWorker = new Worker<OrderJobPayload>(
  ORDER_QUEUE_NAME,
  async (job) => {
    return processOrderJob(job);
  },
  {
    connection: bullMQConnection,
    concurrency: WORKER_CONCURRENCY,
    // Tự động quản lý lock renewal cho các job tốn thời gian
    lockDuration: 30000,
  }
);

// Worker Lifecycle Events & Error Handling
orderWorker.on('ready', () => {
  console.log(`🚀 [OrderWorker] Đã kết nối và sẵn sàng xử lý queue "${ORDER_QUEUE_NAME}" với Concurrency = ${WORKER_CONCURRENCY}`);
});

orderWorker.on('completed', (job: Job<OrderJobPayload>) => {
  console.log(`🎉 [OrderWorker:Completed] Job ${job.id} (Order ${job.data.orderId}) hoàn thành mỹ mãn.`);
});

/**
 * XỬ LÝ LỖI, RETRY VÀ DEAD LETTER QUEUE (DLQ) & ROLLBACK:
 * - Khi Job thất bại trong 1 lần thử: BullMQ tự động kích hoạt Exponential Backoff để retry.
 * - Khi Job thất bại vĩnh viễn (attemptsMade >= attempts):
 *   1. Đẩy job sang Dead Letter Queue (`order-dead-letter-queue`).
 *   2. Bù trừ dữ liệu (Compensation Transaction / Rollback): Hoàn trả lại tồn kho vào Redis Key qua `redis.call('incrby', ...)`.
 */
orderWorker.on('failed', async (job: Job<OrderJobPayload> | undefined, err: Error) => {
  if (!job) {
    console.error(`💥 [OrderWorker:Failed] Lỗi worker không xác định: ${err.message}`);
    return;
  }

  const maxAttempts = job.opts.attempts || 3;
  const isFinalAttempt = job.attemptsMade >= maxAttempts;

  console.error(
    `❌ [OrderWorker:Failed] Job ${job.id} (Order ${job.data.orderId}) thất bại lần ${job.attemptsMade}/${maxAttempts}. Lỗi: ${err.message}`
  );

  if (isFinalAttempt) {
    console.error(
      `🚨 [OrderWorker:DLQ] Job ${job.id} đã thất bại vĩnh viễn sau ${job.attemptsMade} lần thử! Bắt đầu chuyển vào DLQ và hoàn trả tồn kho Redis...`
    );

    try {
      // 1. Đẩy vào Dead Letter Queue (DLQ) để đội vận hành có thể inspect / replay thủ công
      await orderDlqQueue.add(
        'dead-letter-order',
        {
          ...job.data,
          failedReason: err.message,
          stacktrace: job.stacktrace || undefined,
          attemptsMade: job.attemptsMade,
          failedAt: Date.now(),
        },
        {
          jobId: `dlq-${job.data.orderId}`,
        }
      );
      console.log(`📦 [OrderWorker:DLQ] Đã lưu thông tin Job ${job.id} vào DLQ "${orderDlqQueue.name}".`);

      // 2. Rollback Compensation: Cộng trả lại số lượng tồn kho vào Redis Key qua Lua Script (incrby)
      const restoredStock = await flashSaleInventoryService.rollbackStock(
        job.data.productId,
        job.data.quantity
      );
      console.log(
        `🔄 [OrderWorker:Rollback] Đã hoàn trả tồn kho Redis thành công cho Product [${job.data.productId}]. Số lượng hoàn trả: +${job.data.quantity}. Tồn kho Redis mới: ${restoredStock}`
      );
    } catch (compensationError: any) {
      console.error(
        `💥 [OrderWorker:CRITICAL] Thất bại trong quá trình bù trừ dữ liệu (DLQ / Redis Rollback): ${compensationError.message}`,
        compensationError
      );
    }
  }
});

orderWorker.on('error', (err) => {
  console.error(`⚠️ [OrderWorker] Lỗi kết nối worker: ${err.message}`);
});
