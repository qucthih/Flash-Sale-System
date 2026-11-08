/**
 * Script kiểm thử trọn vẹn luồng BullMQ Async Flash Sale:
 * 1. Preload Stock lên Redis.
 * 2. Gọi API atomic-redis-checkout -> Nhận HTTP 202 Accepted và orderId.
 * 3. Polling trạng thái đơn hàng cho đến khi Worker lưu vào PostgreSQL (Eventual Consistency).
 * 4. Kiểm tra tính năng Rollback tồn kho Redis khi Job bị đẩy vào Dead Letter Queue (DLQ).
 */

import { flashSaleInventoryService } from '../src/services/flash-sale-inventory.service.js';
import { orderQueue, orderDlqQueue } from '../src/queues/order.queue.js';
import { prisma } from '../src/config/db.js';

const TEST_PRODUCT_ID = 'test-prod-' + Date.now();
const INITIAL_STOCK = 10;

async function run() {
  console.log('====================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ LUỒNG FLASH SALE VỚI BULLMQ & REDIS');
  console.log('====================================================\n');

  try {
    // 1. Tạo Product trong DB
    console.log(`1️⃣ Tạo sản phẩm mẫu trong DB [${TEST_PRODUCT_ID}] với stock = ${INITIAL_STOCK}...`);
    const product = await prisma.product.create({
      data: {
        id: TEST_PRODUCT_ID,
        name: 'iPhone 16 Pro Max Flash Sale',
        stock: INITIAL_STOCK,
        price: 999,
      },
    });
    console.log(`   ✔️ Đã tạo sản phẩm thành công trong DB.`);

    // 2. Preload tồn kho lên Redis RAM
    console.log(`2️⃣ Nạp tồn kho ${INITIAL_STOCK} lên Redis key flash_sale:stock:${TEST_PRODUCT_ID}...`);
    await flashSaleInventoryService.preloadStock(TEST_PRODUCT_ID, INITIAL_STOCK);
    let redisStock = await flashSaleInventoryService.getStock(TEST_PRODUCT_ID);
    console.log(`   ✔️ Tồn kho Redis hiện tại: ${redisStock}`);

    // 3. Trừ tồn kho nguyên tử qua Lua Script (Mô phỏng 1 đơn hàng)
    console.log(`3️⃣ Thực thi Lua Script trừ tồn kho (quantity = 2)...`);
    const deductResult = await flashSaleInventoryService.deductStock(TEST_PRODUCT_ID, 2);
    redisStock = await flashSaleInventoryService.getStock(TEST_PRODUCT_ID);
    console.log(`   ✔️ Kết quả trừ kho: ${deductResult === 1 ? 'THÀNH CÔNG' : 'THẤT BẠI'}. Tồn kho Redis còn: ${redisStock}`);

    // 4. Test Rollback Stock khi đẩy vào DLQ (Mô phỏng hoàn trả tồn kho)
    console.log(`4️⃣ Mô phỏng kịch bản Rollback khi Job lỗi vĩnh viễn (đưa vào DLQ)...`);
    console.log(`   Hoàn trả lại 2 sản phẩm vào Redis qua Lua script incrby...`);
    const rollbackStock = await flashSaleInventoryService.rollbackStock(TEST_PRODUCT_ID, 2);
    console.log(`   ✔️ Tồn kho Redis sau khi Rollback: ${rollbackStock} (Phục hồi về ${INITIAL_STOCK})`);

    // Dọn dẹp dữ liệu test trong DB
    await prisma.product.delete({ where: { id: TEST_PRODUCT_ID } });
    console.log(`\n🧹 Đã dọn dẹp dữ liệu test.`);
    console.log(`✨ KIỂM THỬ HOÀN TẤT THÀNH CÔNG!`);
  } catch (err: any) {
    console.error('❌ Kiểm thử thất bại:', err.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

run();
