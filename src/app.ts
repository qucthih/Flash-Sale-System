import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import apiRouter from './routes/index.js';
import { prisma } from './config/db.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Home Page: Interactive Visual Lab
app.get('/', async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        _count: { select: { orders: true } },
      },
    });

    const sampleProduct = products[0] || null;

    res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Flash Sale System - Concurrency Lab</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #3b82f6;
      --danger: #ef4444;
      --success: #10b981;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 30px 20px;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 800px;
      width: 100%;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.2);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    h1 {
      margin: 12px 0 6px 0;
      font-size: 26px;
    }
    p {
      color: var(--muted);
      margin-top: 0;
      font-size: 14px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .stat-item {
      background: #0f172a;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .stat-label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      margin-top: 5px;
      color: #fff;
    }
    .btn-group {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 15px;
    }
    button {
      cursor: pointer;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 6px;
      border: none;
      transition: all 0.2s;
    }
    .btn-danger {
      background: var(--danger);
      color: white;
    }
    .btn-danger:hover { background: #dc2626; }
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover { background: #2563eb; }
    .btn-outline {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-outline:hover { background: #334155; }
    pre {
      background: #090d16;
      border: 1px solid var(--border);
      padding: 15px;
      border-radius: 8px;
      font-size: 12px;
      overflow-x: auto;
      max-height: 250px;
    }
    code {
      color: #38bdf8;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <span class="badge">● Server Online (Port ${PORT})</span>
        <h1>⚡ Flash Sale Concurrency Laboratory</h1>
        <p>Mô phỏng và kiểm thử Race Condition (Over-selling) trên PostgreSQL</p>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">📦 Thông tin sản phẩm Flash Sale</h3>
      ${
        sampleProduct
          ? `
        <div><strong>Tên:</strong> ${sampleProduct.name}</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;"><strong>ID:</strong> <code id="productId">${sampleProduct.id}</code></div>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Tồn kho trong DB</div>
            <div class="stat-value" id="stockDisplay" style="color: ${sampleProduct.stock < 0 ? '#ef4444' : '#38bdf8'}">${sampleProduct.stock}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Tổng đơn hàng đã tạo</div>
            <div class="stat-value" id="ordersDisplay" style="color: ${sampleProduct._count.orders > 10 ? '#ef4444' : '#10b981'}">${sampleProduct._count.orders}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Giá niêm yết</div>
            <div class="stat-value">$${sampleProduct.price}</div>
          </div>
        </div>
      `
          : `<p style="color: #ef4444;">Chưa có sản phẩm. Hãy chạy <code>npm run prisma:seed</code> trên terminal.</p>`
      }

      <div class="btn-group">
        <button class="btn-danger" onclick="triggerTest('naive-checkout')">🔥 Bắn 30 Request (Naive - Gây Race Condition)</button>
        <button class="btn-primary" onclick="triggerTest('atomic-checkout')">🛡️ Bắn 30 Request (Atomic Decrement)</button>
        <button style="background: #e11d48; color: white;" onclick="triggerTest('atomic-redis-checkout')">⚡ Bắn 30 Request (Redis Lua + BullMQ Queue)</button>
        <button class="btn-outline" onclick="preloadRedis()">💾 Nạp kho lên Redis</button>
        <button class="btn-outline" onclick="resetStock()">🔄 Reset kho về 10</button>
        <button class="btn-outline" onclick="location.reload()">🔃 Làm mới trang</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">📊 Console Log Kiểm Thử Trực Tiếp</h3>
      <pre id="outputLog">Nhấn một nút phía trên để bắt đầu thử nghiệm đồng thời...</pre>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">📡 Danh sách API Endpoints</h3>
      <ul>
        <li><code>POST /api/v1/orders/naive-checkout</code>: Checkout cơ bản (gây Over-selling).</li>
        <li><code>POST /api/v1/orders/pessimistic-checkout</code>: Khóa dòng bằng <code>SELECT ... FOR UPDATE</code>.</li>
        <li><code>POST /api/v1/orders/atomic-checkout</code>: Conditional Update (Khuyên dùng).</li>
        <li><code>GET  /api/v1/orders/products</code>: Xem toàn bộ sản phẩm và số lượng tồn.</li>
      </ul>
    </div>
  </div>

  <script>
    const productId = '${sampleProduct ? sampleProduct.id : ''}';
    const logEl = document.getElementById('outputLog');

    function log(msg) {
      logEl.textContent = msg;
    }

    async function triggerTest(strategy) {
      if (!productId) return alert('Chưa có sản phẩm!');
      log('⏳ Đang bắn 30 requests đồng thời tới /api/v1/orders/' + strategy + ' ...');

      const startTime = Date.now();
      const promises = Array.from({ length: 30 }, () => 
        fetch('/api/v1/orders/' + strategy, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, quantity: 1 })
        }).then(r => r.json().then(data => ({ status: r.status, data })))
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      const success = results.filter(r => r.status === 201 || r.status === 200 || r.status === 202).length;
      const failed = results.filter(r => r.status === 400).length;

      let msg = '⏱️ Hoàn thành trong: ' + duration + 'ms\\n';
      msg += '✅ Đơn hàng thành công / chấp nhận (HTTP 200/201/202): ' + success + '\\n';
      msg += '❌ Bị từ chối hết hàng (HTTP 400):                    ' + failed + '\\n\\n';

      if (strategy === 'naive-checkout' && success > 10) {
        msg += '🚨 PHÁT HIỆN LỖI RACE CONDITION (OVER-SELLING)!\\n';
        msg += 'Kho chỉ có 10 nhưng hệ thống đã tạo ' + success + ' đơn hàng!\\n';
      } else if (success <= 10) {
        msg += '🛡️ AN TOÀN: Số đơn thành công (' + success + ') không vượt quá tồn kho.\\n';
      }

      log(msg);
      // Cập nhật lại số liệu
      setTimeout(() => location.reload(), 1500);
    }

    async function preloadRedis() {
      if (!productId) return;
      log('⏳ Đang nạp số lượng tồn kho lên Redis RAM...');
      const res = await fetch('/api/v1/orders/redis-preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, stock: 10 })
      });
      const data = await res.json();
      log(data.message || JSON.stringify(data));
    }

    async function resetStock() {
      if (!productId) return;
      log('⏳ Đang reset tồn kho về 10...');
      await fetch('/api/v1/orders/reset-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, stock: 10 })
      });
      location.reload();
    }
  </script>
</body>
</html>
    `);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API Routes
app.use('/api/v1', apiRouter);

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Error]:', err);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

const DEFAULT_PRODUCT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function bootstrap() {
  try {
    // 1. Tự động kiểm tra và khởi tạo sản phẩm mẫu nếu DB chưa có (Auto-seed)
    const product = await prisma.product.upsert({
      where: { id: DEFAULT_PRODUCT_ID },
      update: {},
      create: {
        id: DEFAULT_PRODUCT_ID,
        name: 'iPhone 15 Pro Max 256GB (Flash Sale Edition)',
        stock: 10,
        price: 1199.99,
      },
    });
    console.log(`📦 [Database] Sản phẩm Flash Sale sẵn sàng: [${product.id}], Tồn kho: ${product.stock}`);

    // 2. Tự động preload tồn kho lên Redis RAM
    const { flashSaleInventoryService } = await import('./services/flash-sale-inventory.service.js');
    await flashSaleInventoryService.preloadStock(product.id, product.stock);
    console.log(`⚡ [Redis] Đã nạp thành công tồn kho lên RAM: flash_sale:stock:${product.id} = ${product.stock}`);
  } catch (err: any) {
    console.warn(`⚠️ [Bootstrap] Chưa thể hoàn tất auto-seed / preload tồn kho: ${err.message}`);
  }

  // 3. Tự động khởi chạy Order Worker nếu không chạy worker riêng biệt bằng process khác
  if (process.env.START_WORKER !== 'false') {
    import('./workers/order.worker.js')
      .then(() => console.log('⚡ [BullMQ] Embedded Order Worker đã khởi chạy.'))
      .catch((err) => console.warn('⚠️ [BullMQ] Không thể khởi chạy embedded worker:', err.message));
  }
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Flash Sale Server is running on http://localhost:${PORT}`);
    console.log(`🎯 Test endpoint: POST http://localhost:${PORT}/api/v1/orders/atomic-redis-checkout`);
    bootstrap();
  });
}

export default app;
