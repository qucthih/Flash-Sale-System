/**
 * Benchmark & Comparison Script
 * So sánh 3 chiến lược xử lý đồng thời trong Flash Sale:
 * 1. Naive Implementation (Bị Race Condition / Over-selling)
 * 2. Pessimistic Locking (SELECT ... FOR UPDATE)
 * 3. Atomic Decrement (Conditional Update gte quantity)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PRODUCT_ID = process.env.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const INITIAL_STOCK = 10;
const CONCURRENT_REQUESTS = 30;

interface TestResult {
  strategy: string;
  durationMs: number;
  success201: number;
  outOfStock400: number;
  finalStockInDB: number;
  totalOrdersInDB: number;
  hasRaceCondition: boolean;
}

async function resetStock() {
  const res = await fetch(`${BASE_URL}/api/v1/orders/reset-stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: PRODUCT_ID, stock: INITIAL_STOCK }),
  });
  if (!res.ok) {
    throw new Error(`Failed to reset stock: ${res.statusText}`);
  }
}

async function getProductState() {
  const res = await fetch(`${BASE_URL}/api/v1/orders/products/${PRODUCT_ID}`);
  const data: any = await res.json();
  return {
    stock: data.data.stock,
    totalOrders: data.data._count.orders,
  };
}

async function runStrategy(strategyName: string, endpoint: string): Promise<TestResult> {
  console.log(`\n--------------------------------------------------------------`);
  console.log(`▶ Đang chạy thử nghiệm: [${strategyName}]...`);

  // 1. Reset tồn kho về 10
  await resetStock();

  // 2. Bắn requests đồng thời
  const startTime = Date.now();
  const requests = Array.from({ length: CONCURRENT_REQUESTS }, async (_, idx) => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/orders/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
      });
      return { status: res.status };
    } catch {
      return { status: 500 };
    }
  });

  const responses = await Promise.all(requests);
  const durationMs = Date.now() - startTime;

  const success201 = responses.filter((r) => r.status === 201).length;
  const outOfStock400 = responses.filter((r) => r.status === 400).length;

  // 3. Lấy dữ liệu DB
  const dbState = await getProductState();
  const hasRaceCondition = dbState.totalOrders > INITIAL_STOCK;

  console.log(`   ⏱️ Thời gian xử lý: ${durationMs}ms`);
  console.log(`   ✅ 201 Thành công: ${success201} | ❌ 400 Hết hàng: ${outOfStock400}`);
  console.log(`   📦 Stock còn lại trong DB: ${dbState.stock} | 📋 Đơn hàng trong DB: ${dbState.totalOrders}`);
  if (hasRaceCondition) {
    console.log(`   🚨 PHÁT HIỆN LỖI: Bán vượt tồn kho (${dbState.totalOrders}/${INITIAL_STOCK})!`);
  } else {
    console.log(`   🛡️ AN TOÀN: Số đơn hàng không vượt quá tồn kho ban đầu.`);
  }

  return {
    strategy: strategyName,
    durationMs,
    success201,
    outOfStock400,
    finalStockInDB: dbState.stock,
    totalOrdersInDB: dbState.totalOrders,
    hasRaceCondition,
  };
}

async function main() {
  console.log(`==============================================================`);
  console.log(`📊 BENCHMARK SO SÁNH 3 CHIẾN LƯỢC CONCURRENCY FLASH SALE`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Tồn kho ban đầu: ${INITIAL_STOCK} | Số request đồng thời: ${CONCURRENT_REQUESTS}`);
  console.log(`==============================================================`);

  try {
    const naive = await runStrategy('1. Naive (Không Lock)', 'naive-checkout');
    const pessimistic = await runStrategy('2. Pessimistic Lock', 'pessimistic-checkout');
    const atomic = await runStrategy('3. Atomic Decrement', 'atomic-checkout');

    console.log(`\n==============================================================`);
    console.log(`🏆 TỔNG KẾT SO SÁNH`);
    console.log(`==============================================================`);
    console.table([
      {
        'Chiến lược': naive.strategy,
        'Thời gian (ms)': `${naive.durationMs}ms`,
        'Đơn thành công (201)': naive.success201,
        'Đơn bị từ chối (400)': naive.outOfStock400,
        'Đơn tạo trong DB': `${naive.totalOrdersInDB}/${INITIAL_STOCK}`,
        'Race Condition?': naive.hasRaceCondition ? '🚨 CÓ (Over-selling)' : 'Không',
      },
      {
        'Chiến lược': pessimistic.strategy,
        'Thời gian (ms)': `${pessimistic.durationMs}ms`,
        'Đơn thành công (201)': pessimistic.success201,
        'Đơn bị từ chối (400)': pessimistic.outOfStock400,
        'Đơn tạo trong DB': `${pessimistic.totalOrdersInDB}/${INITIAL_STOCK}`,
        'Race Condition?': pessimistic.hasRaceCondition ? '🚨 CÓ' : '🛡️ AN TOÀN',
      },
      {
        'Chiến lược': atomic.strategy,
        'Thời gian (ms)': `${atomic.durationMs}ms`,
        'Đơn thành công (201)': atomic.success201,
        'Đơn bị từ chối (400)': atomic.outOfStock400,
        'Đơn tạo trong DB': `${atomic.totalOrdersInDB}/${INITIAL_STOCK}`,
        'Race Condition?': atomic.hasRaceCondition ? '🚨 CÓ' : '🛡️ AN TOÀN',
      },
    ]);
  } catch (err: any) {
    console.error('❌ Lỗi khi chạy benchmark:', err.message);
    console.log('👉 Hãy đảm bảo server đang chạy bằng lệnh `npm run dev` trước khi test.');
  }
}

main();

