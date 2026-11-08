import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';

const router = Router();

// 1. Naive Checkout (Read-Modify-Write, dễ bị Race Condition / Over-selling)
router.post('/naive-checkout', (req, res, next) => {
  orderController.naiveCheckout(req, res, next);
});

// 2. Pessimistic Lock Checkout (SELECT ... FOR UPDATE)
router.post('/pessimistic-checkout', (req, res, next) => {
  orderController.pessimisticCheckout(req, res, next);
});

// 3. Database Atomic Decrement Checkout (Conditional Update: WHERE stock >= quantity)
router.post('/atomic-checkout', (req, res, next) => {
  orderController.atomicCheckout(req, res, next);
});

// 4. Redis Lua Script Atomic Checkout + BullMQ Asynchronous Processing
router.post('/atomic-redis-checkout', (req, res, next) => {
  orderController.atomicRedisCheckout(req, res, next);
});

// Polling order status (DB / BullMQ / DLQ)
router.get('/status/:orderId', (req, res, next) => {
  orderController.getOrderStatus(req, res, next);
});

// 5. Redis Helpers (Preload & Check stock trên RAM)
router.post('/redis-preload', (req, res, next) => {
  orderController.preloadRedisStock(req, res, next);
});

router.get('/redis-stock/:id', (req, res, next) => {
  orderController.getRedisStock(req, res, next);
});

// 6. Database Helpers
router.post('/reset-stock', (req, res, next) => {
  orderController.resetStock(req, res, next);
});

router.get('/products', (req, res, next) => {
  orderController.listProducts(req, res, next);
});

router.get('/products/:id', (req, res, next) => {
  orderController.getProduct(req, res, next);
});

export default router;
