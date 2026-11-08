import dotenv from 'dotenv';
dotenv.config();

import { orderWorker } from './workers/order.worker.js';
import { orderQueue, orderDlqQueue } from './queues/order.queue.js';
import { prisma } from './config/db.js';
import { redis } from './config/redis.js';

console.log('====================================================');
console.log('👷 Flash Sale Order Worker Process is starting...');
console.log('====================================================');

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Nhận tín hiệu [${signal}], đang dừng worker và đóng các kết nối một cách an toàn...`);

  try {
    await orderWorker.close();
    console.log('✔️ BullMQ OrderWorker đã dừng tiếp nhận job mới.');

    await orderQueue.close();
    await orderDlqQueue.close();
    console.log('✔️ BullMQ Queues đã đóng.');

    await prisma.$disconnect();
    console.log('✔️ Prisma Database disconnected.');

    await redis.quit();
    console.log('✔️ Redis connection closed.');

    console.log('👋 Worker process đã kết thúc an toàn.');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Lỗi khi thực hiện graceful shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
