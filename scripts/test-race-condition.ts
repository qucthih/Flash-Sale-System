/**
 * Script kiểm thử Race Condition cho Flash Sale (Naive Implementation).
 * Gửi 30 request đồng thời (concurrent) bằng Promise.all tới endpoint /naive-checkout.
 * 
 * Dự kiến với Naive Implementation:
 * - Tồn kho ban đầu: 10
 * - Số request đồng thời: 30
 * - Kết quả mong muốn lý thuyết: 10 thành công (201), 20 thất bại (400 - hết hàng).
 * - Kết quả thực tế do Race Condition (Over-selling): Rất nhiều (>10) request thành công,
 *   tổng số đơn hàng được tạo vượt quá số lượng 10 ban đầu.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PRODUCT_ID = process.env.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CONCURRENT_REQUESTS = 30;

async function runTest() {
  console.log(`\n======================================================`);
  console.log(`🧪 BẮT ĐẦU KIỂM THỬ RACE CONDITION (OVER-SELLING)`);
  console.log(`   Endpoint: POST ${BASE_URL}/api/v1/orders/naive-checkout`);
  console.log(`   Product ID: ${PRODUCT_ID}`);
  console.log(`   Số lượng request đồng thời: ${CONCURRENT_REQUESTS}`);
  console.log(`======================================================\n`);

  // 1. Kiểm tra tồn kho trước khi test
  try {
    const preCheckRes = await fetch(`${BASE_URL}/api/v1/orders/products/${PRODUCT_ID}`);
    if (preCheckRes.ok) {
      const data: any = await preCheckRes.json();
      console.log(`📦 Tồn kho ban đầu trong DB: ${data.data.stock}`);
      console.log(`📋 Số đơn hàng hiện có: ${data.data._count.orders}\n`);
    }
  } catch (err) {
    console.warn('⚠️ Không thể kiểm tra trước sản phẩm (server có thể chưa khởi động).');
  }

  console.log(`🚀 Đang bắn ${CONCURRENT_REQUESTS} request đồng thời...`);

  const startTime = Date.now();

  const requests = Array.from({ length: CONCURRENT_REQUESTS }, async (_, index) => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/orders/naive-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: PRODUCT_ID,
          quantity: 1,
        }),
      });

      const body: any = await res.json().catch(() => ({}));
      return {
        index: index + 1,
        status: res.status,
        success: res.status === 201,
        message: body.message,
      };
    } catch (err: any) {
      return {
        index: index + 1,
        status: 500,
        success: false,
        message: err.message,
      };
    }
  });

  const results = await Promise.all(requests);
  const duration = Date.now() - startTime;

  const successCount = results.filter((r) => r.status === 201).length;
  const outOfStockCount = results.filter((r) => r.status === 400).length;
  const errorCount = results.filter((r) => r.status !== 201 && r.status !== 400).length;

  console.log(`\n⏱️ Hoàn thành trong ${duration}ms\n`);
  console.log(`📊 KẾT QUẢ TEST:`);
  console.log(`   ✅ Đơn hàng thành công (HTTP 201): ${successCount}`);
  console.log(`   ❌ Hết hàng bị từ chối (HTTP 400): ${outOfStockCount}`);
  if (errorCount > 0) {
    console.log(`   ⚠️ Lỗi khác: ${errorCount}`);
  }

  // 2. Kiểm tra tồn kho và số đơn trong DB sau khi test
  try {
    const postCheckRes = await fetch(`${BASE_URL}/api/v1/orders/products/${PRODUCT_ID}`);
    if (postCheckRes.ok) {
      const data: any = await postCheckRes.json();
      console.log(`\n🔍 TÌNH TRẠNG DATABASE SAU KHI TEST:`);
      console.log(`   📦 Tồn kho còn lại trong DB: ${data.data.stock}`);
      console.log(`   📋 Tổng số đơn hàng thực tế: ${data.data._count.orders}`);

      if (data.data._count.orders > 10) {
        console.log(`\n🚨 PHÁT HIỆN LỖI RACE CONDITION (OVER-SELLING)!`);
        console.log(`   Ban đầu chỉ có 10 sản phẩm nhưng hệ thống đã tạo thành công ${data.data._count.orders} đơn hàng!`);
      } else {
        console.log(`\nChưa phát hiện race condition (hoặc request chạy tuần tự).`);
      }
    }
  } catch (err) {
    console.warn('⚠️ Không thể lấy trạng thái database sau test.');
  }

  console.log(`\n======================================================\n`);
}

runTest();

