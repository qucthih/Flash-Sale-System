import { randomUUID } from 'crypto';
import { prisma } from '../config/db.js';
import { flashSaleInventoryService } from './flash-sale-inventory.service.js';
import { orderQueue, orderDlqQueue, OrderJobPayload } from '../queues/order.queue.js';

export interface CheckoutDTO {
  productId: string;
  quantity: number;
  userId?: string;
}

export class OrderService {
  /**
   * 1. NAIVE CHECKOUT (Dễ bị Race Condition / Over-selling):
   * Thực hiện theo cơ chế Read-Modify-Write cơ bản.
   * KHÔNG sử dụng DB Lock hay Atomic Decrement.
   */
  async naiveCheckout({ productId, quantity }: CheckoutDTO) {
    // a. Query lấy thông tin Product
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      const error: any = new Error('Product not found');
      error.statusCode = 404;
      throw error;
    }

    // b. Kiểm tra tồn kho
    if (product.stock < quantity) {
      const error: any = new Error(`Out of stock. Available: ${product.stock}, Requested: ${quantity}`);
      error.statusCode = 400;
      error.currentStock = product.stock;
      throw error;
    }

    // Trừ tồn kho bằng update thông thường (Read-Modify-Write anti-pattern)
    const newStock = product.stock - quantity;
    await prisma.product.update({
      where: { id: productId },
      data: { stock: newStock },
    });

    // c. Tạo bản ghi mới trong bảng Order
    const order = await prisma.order.create({
      data: {
        productId,
        quantity,
        status: 'SUCCESS',
      },
      include: {
        product: true,
      },
    });

    return {
      order,
      remainingStock: newStock,
    };
  }

  /**
   * 2. PESSIMISTIC LOCKING CHECKOUT (SELECT ... FOR UPDATE):
   * Khóa hàng (Row-level lock) trong suốt transaction.
   * Các request khác vào cùng một product sẽ phải chờ request trước giải phóng lock.
   */
  async pessimisticCheckout({ productId, quantity }: CheckoutDTO) {
    return prisma.$transaction(async (tx) => {
      // a. Khóa dòng bản ghi sản phẩm bằng SELECT ... FOR UPDATE
      const rows: any[] = await tx.$queryRaw`
        SELECT * FROM "products" WHERE id = ${productId} FOR UPDATE
      `;

      const product = rows[0];
      if (!product) {
        const error: any = new Error('Product not found');
        error.statusCode = 404;
        throw error;
      }

      // b. Kiểm tra tồn kho an toàn vì đã giữ lock
      if (product.stock < quantity) {
        const error: any = new Error(`Out of stock. Available: ${product.stock}, Requested: ${quantity}`);
        error.statusCode = 400;
        error.currentStock = product.stock;
        throw error;
      }

      // c. Cập nhật tồn kho và tạo đơn hàng
      const newStock = product.stock - quantity;
      await tx.product.update({
        where: { id: productId },
        data: { stock: newStock },
      });

      const order = await tx.order.create({
        data: {
          productId,
          quantity,
          status: 'SUCCESS',
        },
        include: {
          product: true,
        },
      });

      return {
        order,
        remainingStock: newStock,
      };
    });
  }

  /**
   * 3. ATOMIC DECREMENT CHECKOUT (Conditional Update / Single Query):
   * UPDATE products SET stock = stock - quantity WHERE id = productId AND stock >= quantity
   * Tận dụng triệt để tính nguyên tử của Database engine mà không cần lock chờ.
   * Khuyên dùng trong sản xuất cho hiệu năng cao nhất.
   */
  async atomicCheckout({ productId, quantity }: CheckoutDTO) {
    return prisma.$transaction(async (tx) => {
      // a. Trừ tồn kho có điều kiện (Conditional Update)
      const updateResult = await tx.product.updateMany({
        where: {
          id: productId,
          stock: { gte: quantity }, // Điều kiện chặn race condition tại tầng DB
        },
        data: {
          stock: { decrement: quantity },
        },
      });

      // Nếu count === 0 nghĩa là stock không đủ hoặc sản phẩm không tồn tại
      if (updateResult.count === 0) {
        // Kiểm tra xem sản phẩm có tồn tại không để trả mã lỗi chính xác
        const exists = await tx.product.findUnique({ where: { id: productId } });
        if (!exists) {
          const error: any = new Error('Product not found');
          error.statusCode = 404;
          throw error;
        }

        const error: any = new Error(`Out of stock. Current stock is less than ${quantity}`);
        error.statusCode = 400;
        error.currentStock = exists.stock;
        throw error;
      }

      // b. Tạo đơn hàng khi trừ kho thành công
      const order = await tx.order.create({
        data: {
          productId,
          quantity,
          status: 'SUCCESS',
        },
      });

      const updatedProduct = await tx.product.findUnique({ where: { id: productId } });

      return {
        order,
        remainingStock: updatedProduct?.stock ?? 0,
      };
    });
  }

  /**
   * Helper: Reset lại tồn kho và xóa các đơn hàng cũ để chuẩn bị cho test kế tiếp
   */
  async resetProductStock(productId: string, initialStock = 10) {
    await prisma.order.deleteMany({
      where: { productId },
    });

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { stock: initialStock },
    });

    return updated;
  }

  async getProductById(productId: string) {
    return prisma.product.findUnique({
      where: { id: productId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { orders: true },
        },
      },
    });
  }

  async getAllProducts() {
    return prisma.product.findMany({
      include: {
        _count: {
          select: { orders: true },
        },
      },
    });
  }

  /**
   * 4. ATOMIC REDIS CHECKOUT VỚI MESSAGE QUEUE (BULLMQ):
   * - Trừ tồn kho nguyên tử in-memory trên Redis qua Lua Script.
   * - Khi trừ kho thành công, đẩy Job vào Message Queue 'order-processing-queue'.
   * - Trả về ngay HTTP 202 Accepted cho client kèm orderId.
   */
  async atomicRedisCheckout({ productId, quantity, userId }: CheckoutDTO) {
    // 1. Thực thi Lua Script trừ tồn kho trên Redis
    const deductResult = await flashSaleInventoryService.deductStock(productId, quantity);

    if (deductResult === 0) {
      const error: any = new Error('Out of stock or product not found on Redis');
      error.statusCode = 400;
      error.reason = 'OUT_OF_STOCK';
      throw error;
    }

    // 2. Trừ tồn kho Redis thành công -> Tạo Job payload
    const orderId = randomUUID();
    const resolvedUserId = userId || `user_${randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();

    const jobPayload: OrderJobPayload = {
      orderId,
      productId,
      userId: resolvedUserId,
      quantity,
      timestamp,
    };

    // 3. Đẩy Job vào BullMQ 'order-processing-queue'
    await orderQueue.add('process-order', jobPayload, {
      jobId: orderId, // Đảm bảo Idempotency: không tạo 2 job trùng id
    });

    return {
      orderId,
      productId,
      userId: resolvedUserId,
      quantity,
      status: 'ACCEPTED',
      timestamp,
    };
  }

  /**
   * Helper: Polling trạng thái đơn hàng (Order Status Polling Endpoint)
   * Giúp Client kiểm tra đơn hàng đã được worker lưu vào DB chưa
   */
  async getOrderStatus(orderId: string) {
    // 1. Kiểm tra trực tiếp trong PostgreSQL
    const dbOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true },
    });

    if (dbOrder) {
      return {
        orderId,
        status: dbOrder.status, // SUCCESS
        isPersisted: true,
        order: dbOrder,
      };
    }

    // 2. Nếu chưa có trong DB, kiểm tra trong BullMQ Queue
    const job = await orderQueue.getJob(orderId);
    if (job) {
      const state = await job.getState();
      return {
        orderId,
        status: state === 'active' ? 'PROCESSING' : 'QUEUED',
        isPersisted: false,
        attemptsMade: job.attemptsMade,
        queueState: state,
      };
    }

    // 3. Kiểm tra trong Dead Letter Queue (DLQ)
    const dlqJob = await orderDlqQueue.getJob(`dlq-${orderId}`);
    if (dlqJob) {
      return {
        orderId,
        status: 'FAILED',
        isPersisted: false,
        failedReason: dlqJob.data.failedReason,
        failedAt: dlqJob.data.failedAt,
      };
    }

    return null;
  }
}

export const orderService = new OrderService();
