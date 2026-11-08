# ⚡ Flash Sale System - Concurrency & Race Condition Laboratory

Hệ thống mô phỏng bài toán bán hàng Flash Sale với tải cao (High Concurrency) phục vụ việc kiểm thử, tái hiện lỗi **Race Condition (Over-selling)** và đo lường đối chiếu giữa **3 chiến lược kỹ thuật**:
1. **Naive Implementation** (Anti-pattern: Read-Modify-Write, không lock).
2. **Pessimistic Locking** (`SELECT ... FOR UPDATE` trên PostgreSQL).
3. **Database Atomic Decrement** (Conditional Update `stock >= quantity`, hiệu năng cao nhất).

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+, TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL 16
- **ORM**: Prisma ORM

---

## 📂 Cấu trúc mã nguồn

```text
Flash-Sale-System/
├── docker-compose.dev.yml          # Container PostgreSQL phục vụ local dev
├── prisma/
│   ├── schema.prisma               # Schema Product & Order
│   └── seed.ts                     # Seed 1 sản phẩm mẫu stock = 10
├── src/
│   ├── config/
│   │   └── db.ts                   # Prisma Client Singleton
│   ├── controllers/
│   │   └── order.controller.ts     # Controller xử lý cả 3 chiến lược
│   ├── services/
│   │   └── order.service.ts        # Business logic: Naive, Pessimistic, Atomic
│   ├── routes/
│   │   ├── index.ts                # Root API router (/api/v1)
│   │   └── order.routes.ts         # Routes đặt hàng & reset kho
│   └── app.ts                      # Entrypoint Express server
├── scripts/
│   ├── test-race-condition.ts      # Bắn 30 requests kiểm thử riêng Naive
│   └── benchmark-all.ts            # Chạy benchmark tự động so sánh cả 3 giải pháp
├── .env.example & .env
├── package.json
└── tsconfig.json
```

---

## 🚀 Hướng dẫn cài đặt & Khởi động

### 1. Khởi động Database
- **Cách A (Docker)**: `docker compose -f docker-compose.dev.yml up -d`
- **Cách B (Cloud Postgres miễn phí)**: Đăng ký tại [Neon.tech](https://neon.tech), dán Connection String vào file `.env`.

### 2. Cài đặt dependencies & Chạy migration:
```bash
npm install
npx prisma migrate dev --name init
npm run prisma:seed
```

### 3. Khởi động Server:
```bash
npm run dev
```
Server chạy tại: `http://localhost:3000`

---

## 📡 API Endpoints

| Endpoint | Method | Chiến lược | Mô tả |
| :--- | :--- | :--- | :--- |
| `/api/v1/orders/naive-checkout` | `POST` | **Naive** | Read-Modify-Write thông thường (Dễ bị Over-selling) |
| `/api/v1/orders/pessimistic-checkout` | `POST` | **Pessimistic Lock** | Dùng `SELECT ... FOR UPDATE` khóa dòng sản phẩm |
| `/api/v1/orders/atomic-checkout` | `POST` | **Atomic Decrement** | Dùng Conditional Update `stock >= quantity` (Khuyên dùng) |
| `/api/v1/orders/reset-stock` | `POST` | Helper | Xóa đơn cũ và reset stock về số lượng ban đầu |
| `/api/v1/orders/products/:id` | `GET` | Helper | Kiểm tra số lượng tồn kho và tổng số đơn hiện tại |

**Format Body gửi lên:**
```json
{
  "productId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "quantity": 1
}
```

---

## 📊 Chạy Benchmark So Sánh Cả 3 Chiến Lược

Khi server đang chạy (`npm run dev`), mở một terminal khác và thực thi:

```bash
npm run test:benchmark
```

Script sẽ tự động:
1. Reset kho về 10 và bắn 30 requests đồng thời vào `/naive-checkout`.
2. Reset kho về 10 và bắn 30 requests đồng thời vào `/pessimistic-checkout`.
3. Reset kho về 10 và bắn 30 requests đồng thời vào `/atomic-checkout`.
4. In ra bảng kết quả tổng kết đối chiếu:

```text
==============================================================
🏆 TỔNG KẾT SO SÁNH
==============================================================
┌─────────┬──────────────────────┬────────────────┬──────────────────────┬─────────────────────┬──────────────────┬──────────────────────┐
│ (index) │      Chiến lược      │ Thời gian (ms) │ Đơn thành công (201) │ Đơn bị từ chối (400) │ Đơn tạo trong DB │    Race Condition?   │
├─────────┼──────────────────────┼────────────────┼──────────────────────┼─────────────────────┼──────────────────┼──────────────────────┤
│    0    │ '1. Naive'           │    '120ms'     │          27          │          3          │     '27/10'      │ 🚨 CÓ (Over-selling) │
│    1    │ '2. Pessimistic Lock'│    '280ms'     │          10          │          20         │     '10/10'      │ 🛡️ AN TOÀN           │
│    2    │ '3. Atomic Decrement'│     '95ms'     │          10          │          20         │     '10/10'      │ 🛡️ AN TOÀN (Nhanh)   │
└─────────┴──────────────────────┴────────────────┴──────────────────────┴─────────────────────┴──────────────────┴──────────────────────┘
```
