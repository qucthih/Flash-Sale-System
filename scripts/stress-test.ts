/**
 * Stress Test Script sử dụng Autocannon
 * Đo lường Throughput (Req/sec), Latency p50, p99 của các chiến lược xử lý đồng thời.
 */

import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PRODUCT_ID = process.env.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const STRATEGY = process.argv[2] || 'atomic'; // 'naive' | 'pessimistic' | 'atomic'

const ENDPOINTS: Record<string, string> = {
  naive: '/api/v1/orders/naive-checkout',
  pessimistic: '/api/v1/orders/pessimistic-checkout',
  atomic: '/api/v1/orders/atomic-checkout',
};

async function resetStock(initialStock = 500) {
  try {
    await fetch(`${BASE_URL}/api/v1/orders/reset-stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: PRODUCT_ID, stock: initialStock }),
    });
  } catch (err) {
    console.error('Không thể reset kho trước khi test.');
  }
}

async function run() {
  const endpoint = ENDPOINTS[STRATEGY] || ENDPOINTS.atomic;
  console.log(`\n======================================================`);
  console.log(`🚀 BẮT ĐẦU STRESS TEST VỚI AUTOCANNON`);
  console.log(`   Chiến lược:   ${STRATEGY.toUpperCase()}`);
  console.log(`   Target:       POST ${BASE_URL}${endpoint}`);
  console.log(`   Connections:  50 concurrent connections`);
  console.log(`   Duration:     5 seconds`);
  console.log(`======================================================\n`);

  // Reset kho với 500 sản phẩm để chịu tải
  await resetStock(500);

  const instance = autocannon(
    {
      url: `${BASE_URL}${endpoint}`,
      connections: 50,
      duration: 5,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        productId: PRODUCT_ID,
        quantity: 1,
      }),
    },
    (err, result) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log(autocannon.printResult(result));
    }
  );

  autocannon.track(instance, { renderProgressBar: true });
}

run();

