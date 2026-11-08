import { prisma } from '../src/config/db.js';

const PRODUCT_ID = process.env.PRODUCT_ID || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const INITIAL_STOCK = 10;

// ANSI escape codes cho màu console
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function verifyDatabaseIntegrity() {
  console.log(`\n${CYAN}================================================================${RESET}`);
  console.log(`${BOLD}🔍 DATABASE INTEGRITY VERIFICATION (POST-LOAD TEST)${RESET}`);
  console.log(`   Product ID:    ${PRODUCT_ID}`);
  console.log(`   Initial Stock: ${INITIAL_STOCK}`);
  console.log(`${CYAN}================================================================${RESET}\n`);

  try {
    // 1. Query trực tiếp bảng Product
    const product = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
    });

    if (!product) {
      console.log(`${RED}❌ LỖI: Không tìm thấy sản phẩm ${PRODUCT_ID} trong database!${RESET}`);
      process.exit(1);
    }

    // 2. Query đếm tổng số đơn hàng trong bảng Order
    const totalOrders = await prisma.order.count({
      where: { productId: PRODUCT_ID },
    });

    // 3. Tính tổng số lượng hàng đã bán (quantity)
    const orderAggregate = await prisma.order.aggregate({
      where: { productId: PRODUCT_ID },
      _sum: { quantity: true },
    });
    const totalQuantitySold = orderAggregate._sum.quantity || 0;

    console.log(`📦 Tồn kho hiện tại trong DB (Product.stock): ${BOLD}${product.stock}${RESET}`);
    console.log(`📋 Tổng số Order được tạo (Order count):     ${BOLD}${totalOrders}${RESET}`);
    console.log(`🛒 Tổng số lượng sản phẩm đã bán:          ${BOLD}${totalQuantitySold}${RESET}\n`);

    // 4. Kiểm tra điều kiện lỗi Over-selling / Race Condition
    const isOverSelling = totalOrders > INITIAL_STOCK || totalQuantitySold > INITIAL_STOCK;
    const isNegativeStock = product.stock < 0;
    const isStockInconsistent = (INITIAL_STOCK - totalQuantitySold) !== product.stock;

    if (isOverSelling || isNegativeStock) {
      console.log(`${RED}################################################################${RESET}`);
      console.log(`${RED}${BOLD}🚨 CẢNH BÁO ĐỎ: PHÁT HIỆN LỖI RACE CONDITION (OVERSELLING)! 🚨${RESET}`);
      console.log(`${RED}################################################################${RESET}`);
      
      if (isOverSelling) {
        console.log(`${RED}❌ TỒN KHO BAN ĐẦU:      ${INITIAL_STOCK}${RESET}`);
        console.log(`${RED}❌ SỐ ĐƠN ĐÃ TẠO:        ${totalOrders} (VƯỢT QUÁ ${totalOrders - INITIAL_STOCK} ĐƠN!)${RESET}`);
      }

      if (isNegativeStock) {
        console.log(`${RED}❌ TỒN KHO BỊ ÂM:        ${product.stock}${RESET}`);
      }

      console.log(`\n${YELLOW}👉 Nguyên nhân kỹ thuật:${RESET}`);
      console.log(`   Cơ chế Read-Modify-Write của /naive-checkout không sử dụng Database Lock.`);
      console.log(`   Khi 1.000 VUs cùng truy vấn trong <5s, hàng trăm request đọc cùng một`);
      console.log(`   giá trị stock cũ trước khi các lệnh update ghi đè (Lost Update Bug).`);
      console.log(`${RED}################################################################${RESET}\n`);
      process.exit(1);
    } else {
      console.log(`${GREEN}================================================================${RESET}`);
      console.log(`${GREEN}${BOLD}✅ TÍNH TOÀN VẸN ĐƯỢC ĐẢM BẢO!${RESET}`);
      console.log(`   Không phát hiện bán lố: ${totalOrders}/${INITIAL_STOCK} đơn hàng.`);
      console.log(`${GREEN}================================================================${RESET}\n`);
    }
  } catch (error) {
    console.error(`${RED}❌ Lỗi khi truy vấn database:${RESET}`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyDatabaseIntegrity();

