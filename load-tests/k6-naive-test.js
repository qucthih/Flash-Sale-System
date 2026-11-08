import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/**
 * ==============================================================================
 * K6 LOAD TEST: FLASH SALE RACE CONDITION (OVER-SELLING DEMO)
 * ==============================================================================
 * Giả lập kịch bản Flash Sale bùng nổ:
 * 1.000 Virtual Users (VUs) đồng loạt gửi POST /naive-checkout trong vòng dưới 5 giây.
 * 
 * Dự kiến kết quả lý thuyết (Nếu hệ thống có concurrency control):
 * - Stock ban đầu: 10
 * - Success (200/201): Đúng 10
 * - Out of Stock (400/409): 990
 * 
 * Dự kiến kết quả thực tế (Naive Implementation bị Race Condition):
 * - Success (200/201): Hàng chục đến hàng trăm đơn thành công (Over-selling)!
 * ==============================================================================
 */

// Custom Metrics để theo dõi chi tiết
const successOrders = new Counter('orders_success_200_201');
const outOfStockOrders = new Counter('orders_out_of_stock_400_409');
const errorOrders = new Counter('orders_other_errors');
const checkoutDuration = new Trend('checkout_duration_ms');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PRODUCT_ID = __ENV.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const STRATEGY = __ENV.STRATEGY || 'naive-checkout'; // 'naive-checkout' | 'atomic-checkout' | 'pessimistic-checkout'

export const options = {
  scenarios: {
    flash_sale_surge: {
      // Mỗi VU thực hiện đúng 1 lần checkout đồng thời
      executor: 'per-vu-iterations',
      vus: 1000,
      iterations: 1,
      maxDuration: '5s',
    },
  },
  thresholds: {
    // Đo lường p95 và p99 latency
    http_req_duration: [
      'p(95)<3000', // 95% request phản hồi dưới 3s
      'p(99)<4500', // 99% request phản hồi dưới 4.5s
    ],
    checkout_duration_ms: ['p(95)<3000', 'p(99)<4500'],
  },
};

export default function () {
  const url = `${BASE_URL}/api/v1/orders/${STRATEGY}`;
  const payload = JSON.stringify({
    productId: PRODUCT_ID,
    quantity: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'POST_NaiveCheckout' },
    timeout: '10s',
  };

  const res = http.post(url, payload, params);

  // Ghi nhận metrics
  checkoutDuration.add(res.timings.duration);

  const isSuccess = res.status === 201 || res.status === 200;
  const isOutOfStock = res.status === 400 || res.status === 409;

  if (isSuccess) {
    successOrders.add(1);
  } else if (isOutOfStock) {
    outOfStockOrders.add(1);
  } else {
    errorOrders.add(1);
  }

  // Assertion kiểm tra status code
  check(res, {
    'HTTP 200/201 (Đặt hàng thành công)': () => isSuccess,
    'HTTP 400/409 (Hết hàng - Out of stock)': () => isOutOfStock,
  });
}

