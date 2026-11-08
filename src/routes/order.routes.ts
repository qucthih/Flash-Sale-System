import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';

const router = Router();

// 1. Naive Checkout (Dễ bị race condition / over-selling)
router.post('/naive-checkout', (req, res, next) => {
  orderController.naiveCheckout(req, res, next);
});

// 2. Pessimistic Lock Checkout (SELECT ... FOR UPDATE)
router.post('/pessimistic-checkout', (req, res, next) => {
  orderController.pessimisticCheckout(req, res, next);
});

// 3. Atomic Decrement Checkout (Conditional Update)
router.post('/atomic-checkout', (req, res, next) => {
  orderController.atomicCheckout(req, res, next);
});

// 4. Helper endpoints
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
