import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/**
 * ==============================================================================
 * K6 LOAD TEST: FLASH SALE OPTIMIZED (REDIS IN-MEMORY + BULLMQ QUEUE)
 * ==============================================================================
 * Giả lập kịch bản Flash Sale bùng nổ:
 * 1.000 Virtual Users (VUs) đồng loạt gửi POST /atomic-redis-checkout trong vòng dưới 5 giây.
 * 
 * Kiến trúc tối ưu:
 * - Kiểm tra và trừ tồn kho nguyên tử in-memory qua Redis Lua Script (O(1)).
 * - Trừ kho thành công: Đẩy Job vào BullMQ `order-processing-queue` và trả về ngay HTTP 202 Accepted.
 * - Hết hàng: Trả về HTTP 400 ngay lập tức, 0% database load.
 * 
 * Dự kiến kết quả lý thuyết & thực tế:
 * - Stock ban đầu: 10
 * - Accepted (HTTP 202): Đúng chính xác 10 đơn hàng (Zero Over-selling!)
 * - Out of Stock (HTTP 400): Đúng chính xác 990 requests bị từ chối
 * - Error Rate (5xx): 0%
 * - Latency p95 / p99: Sub-millisecond đến vài mili-giây (cực kỳ nhanh)
 * ==============================================================================
 */

// Custom Metrics để theo dõi chi tiết
const acceptedOrders = new Counter('orders_accepted_202');
const outOfStockOrders = new Counter('orders_out_of_stock_400');
const errorOrders = new Counter('orders_other_errors');
const checkoutDuration = new Trend('checkout_duration_ms');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PRODUCT_ID = __ENV.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

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
    // Đo lường p95 và p99 latency của In-Memory Redis Gateway
    http_req_duration: [
      'p(95)<500', // 95% request phản hồi dưới 500ms
      'p(99)<1000', // 99% request phản hồi dưới 1s
    ],
    checkout_duration_ms: ['p(95)<500', 'p(99)<1000'],
  },
};

export default function () {
  const url = `${BASE_URL}/api/v1/orders/atomic-redis-checkout`;
  const payload = JSON.stringify({
    productId: PRODUCT_ID,
    quantity: 1,
    userId: `user_vu_${__VU}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'POST_AtomicRedisCheckout' },
    timeout: '10s',
  };

  const res = http.post(url, payload, params);

  // Ghi nhận metrics
  checkoutDuration.add(res.timings.duration);

  const isAccepted = res.status === 202;
  const isOutOfStock = res.status === 400;

  if (isAccepted) {
    acceptedOrders.add(1);
  } else if (isOutOfStock) {
    outOfStockOrders.add(1);
  } else {
    errorOrders.add(1);
  }

  // Assertion kiểm tra status code
  check(res, {
    'HTTP 202 (Đơn hàng được chấp nhận & xếp hàng vào BullMQ)': () => isAccepted,
    'HTTP 400 (Hết hàng - Out of stock)': () => isOutOfStock,
  });
}
