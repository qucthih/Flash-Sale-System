/**
 * Zero-dependency Node.js Spike Test (1.000 requests đồng thời)
 * Dành cho trường hợp chưa cài đặt k6 trên máy, có thể chạy trực tiếp bằng `npm run test:spike`.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PRODUCT_ID = process.env.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const STRATEGY = process.argv[2] || 'naive-checkout'; // 'naive-checkout' | 'atomic-checkout' | 'pessimistic-checkout'
const CONCURRENT_USERS = 1000;

async function runSpikeTest() {
  console.log(`\n======================================================`);
  console.log(`🚀 BẮT ĐẦU SPIKE TEST 1.000 REQUESTS (Node.js Native)`);
  console.log(`   Chiến lược:   ${STRATEGY}`);
  console.log(`   Endpoint:     POST ${BASE_URL}/api/v1/orders/${STRATEGY}`);
  console.log(`   Số VUs:       ${CONCURRENT_USERS} requests`);
  console.log(`======================================================\n`);

  console.log(`⏳ Đang bắn 1.000 requests đồng loạt...`);
  const startTime = Date.now();

  const requests = Array.from({ length: CONCURRENT_USERS }, async (_, index) => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/orders/${STRATEGY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: PRODUCT_ID,
          quantity: 1,
        }),
      });

      return { index, status: res.status };
    } catch (err: any) {
      return { index, status: 500 };
    }
  });

  const results = await Promise.all(requests);
  const duration = Date.now() - startTime;

  const count201 = results.filter((r) => r.status === 201 || r.status === 200).length;
  const count400 = results.filter((r) => r.status === 400 || r.status === 409).length;
  const countError = results.filter((r) => r.status >= 500).length;

  console.log(`\n⏱️ Thời gian thực thi: ${duration}ms (~${(CONCURRENT_USERS / (duration / 1000)).toFixed(1)} requests/s)`);
  console.log(`📊 Kết quả HTTP:`);
  console.log(`   ✅ 200/201 (Đặt hàng thành công): ${count201}`);
  console.log(`   ❌ 400/409 (Báo hết hàng):       ${count400}`);
  if (countError > 0) {
    console.log(`   ⚠️ Lỗi server (5xx):              ${countError}`);
  }

  console.log(`\n👉 Đang tự động kiểm tra tính toàn vẹn database...\n`);
  const { execSync } = await import('child_process');
  execSync('npm run verify:db', { stdio: 'inherit' });
}

runSpikeTest();

