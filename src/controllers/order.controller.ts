import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service.js';
import { flashSaleInventoryService } from '../services/flash-sale-inventory.service.js';

export class OrderController {
  /**
   * Helper function to extract and validate checkout payload
   */
  private extractPayload(req: Request) {
    const { productId, quantity = 1, userId } = req.body;

    if (!productId || typeof productId !== 'string') {
      throw { statusCode: 400, message: 'productId is required and must be a string' };
    }

    const parsedQuantity = Number(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      throw { statusCode: 400, message: 'quantity must be a positive integer' };
    }

    return { productId, quantity: parsedQuantity, userId: userId ? String(userId) : undefined };
  }

  /**
   * POST /api/v1/orders/naive-checkout
   */
  async naiveCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = this.extractPayload(req);
      const result = await orderService.naiveCheckout(payload);

      res.status(201).json({
        success: true,
        strategy: 'naive',
        message: 'Order placed successfully (naive)',
        data: result,
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          strategy: 'naive',
          message: error.message,
          currentStock: error.currentStock,
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/orders/pessimistic-checkout
   */
  async pessimisticCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = this.extractPayload(req);
      const result = await orderService.pessimisticCheckout(payload);

      res.status(201).json({
        success: true,
        strategy: 'pessimistic',
        message: 'Order placed successfully (pessimistic lock)',
        data: result,
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          strategy: 'pessimistic',
          message: error.message,
          currentStock: error.currentStock,
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/orders/atomic-checkout
   */
  async atomicCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = this.extractPayload(req);
      const result = await orderService.atomicCheckout(payload);

      res.status(201).json({
        success: true,
        strategy: 'atomic',
        message: 'Order placed successfully (atomic decrement)',
        data: result,
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          strategy: 'atomic',
          message: error.message,
          currentStock: error.currentStock,
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/orders/atomic-redis-checkout
   * - Trừ tồn kho nguyên tử trên Redis qua Lua script (100.000+ RPS).
   * - Đẩy Job vào Message Queue (BullMQ `order-processing-queue`) để worker lưu DB bất đồng bộ.
   * - Trả về ngay HTTP 202 Accepted kèm orderId để Client polling hoặc nhận trạng thái.
   */
  async atomicRedisCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = this.extractPayload(req);

      // Gọi service thực thi Lua script + Queue Producer
      const result = await orderService.atomicRedisCheckout(payload);

      // Trả về ngay HTTP 202 Accepted kèm orderId
      res.status(202).json({
        success: true,
        strategy: 'atomic-redis-queue',
        message: 'Order accepted and queued for asynchronous processing',
        data: result,
      });
    } catch (error: any) {
      if (error.statusCode === 400 || error.reason === 'OUT_OF_STOCK') {
        res.status(400).json({
          success: false,
          strategy: 'atomic-redis-queue',
          message: error.message || 'Sold Out - Out of stock',
        });
        return;
      }

      // Bọc try-catch cẩn thận và bắt lỗi connection timeout của Redis / Queue
      const isRedisError =
        error.name === 'MaxRetriesPerRequestError' ||
        error.message?.includes('timeout') ||
        error.code === 'ECONNREFUSED' ||
        error.message?.includes('Connection is closed');

      if (isRedisError) {
        res.status(503).json({
          success: false,
          message: 'Redis / Message Queue service is currently unavailable. Please verify Redis connection.',
          error: error.message,
        });
        return;
      }

      next(error);
    }
  }

  /**
   * GET /api/v1/orders/status/:orderId
   * Polling endpoint tra cứu trạng thái đơn hàng (DB -> Queue -> DLQ)
   */
  async getOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderId } = req.params;
      if (!orderId) {
        res.status(400).json({ success: false, message: 'orderId is required' });
        return;
      }

      const status = await orderService.getOrderStatus(orderId);

      if (!status) {
        res.status(404).json({
          success: false,
          message: `Order ${orderId} not found in DB or Processing Queue`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/orders/redis-preload
   * Nạp số lượng tồn kho lên Redis
   */
  async preloadRedisStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId, stock } = req.body;

      if (!productId) {
        res.status(400).json({ success: false, message: 'productId is required' });
        return;
      }

      let stockToPreload = stock !== undefined ? Number(stock) : null;

      // Nếu không truyền stock, lấy từ DB
      if (stockToPreload === null) {
        const product = await orderService.getProductById(productId);
        if (!product) {
          res.status(404).json({ success: false, message: 'Product not found in DB' });
          return;
        }
        stockToPreload = product.stock;
      }

      await flashSaleInventoryService.preloadStock(productId, stockToPreload);

      res.status(200).json({
        success: true,
        message: `Successfully preloaded stock into Redis: flash_sale:stock:${productId} = ${stockToPreload}`,
        data: {
          productId,
          stock: stockToPreload,
        },
      });
    } catch (error: any) {
      res.status(503).json({
        success: false,
        message: 'Failed to preload stock into Redis',
        error: error.message,
      });
    }
  }

  /**
   * GET /api/v1/orders/redis-stock/:id
   */
  async getRedisStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const stock = await flashSaleInventoryService.getStock(id);

      if (stock === null) {
        res.status(404).json({
          success: false,
          message: `Product key flash_sale:stock:${id} not found in Redis. Please call /redis-preload first.`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          productId: id,
          redisStock: stock,
        },
      });
    } catch (error: any) {
      res.status(503).json({
        success: false,
        message: 'Failed to read stock from Redis',
        error: error.message,
      });
    }
  }

  /**
   * POST /api/v1/orders/reset-stock
   * Reset product stock to test again without re-running seed
   */
  async resetStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId, stock = 10 } = req.body;
      if (!productId) {
        res.status(400).json({ success: false, message: 'productId is required' });
        return;
      }

      const initialStock = Number(stock);
      const product = await orderService.resetProductStock(productId, initialStock);

      // Cập nhật luôn cả Redis nếu có
      try {
        await flashSaleInventoryService.preloadStock(productId, initialStock);
      } catch {
        // Bỏ qua nếu Redis chưa bật
      }

      res.status(200).json({
        success: true,
        message: `Stock reset to ${product.stock} and old orders deleted`,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/orders/products/:id
   */
  async getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const product = await orderService.getProductById(id);

      if (!product) {
        res.status(404).json({ success: false, message: 'Product not found' });
        return;
      }

      res.status(200).json({ success: true, data: product });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/orders/products
   */
  async listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const products = await orderService.getAllProducts();
      res.status(200).json({ success: true, data: products });
    } catch (error) {
      next(error);
    }
  }
}

export const orderController = new OrderController();
