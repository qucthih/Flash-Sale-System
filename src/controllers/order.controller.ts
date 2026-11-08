import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service.js';

export class OrderController {
  /**
   * Helper function to extract and validate checkout payload
   */
  private extractPayload(req: Request) {
    const { productId, quantity = 1 } = req.body;

    if (!productId || typeof productId !== 'string') {
      throw { statusCode: 400, message: 'productId is required and must be a string' };
    }

    const parsedQuantity = Number(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      throw { statusCode: 400, message: 'quantity must be a positive integer' };
    }

    return { productId, quantity: parsedQuantity };
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

      const product = await orderService.resetProductStock(productId, Number(stock));
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
