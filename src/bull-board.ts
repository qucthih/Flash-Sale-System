import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { orderQueue, orderDlqQueue } from './queues/order.queue.js';

const app = express();
const PORT = Number(process.env.BULL_BOARD_PORT) || 3001;

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/ui');

createBullBoard({
  queues: [
    new BullMQAdapter(orderQueue),
    new BullMQAdapter(orderDlqQueue),
  ],
  serverAdapter,
});

app.use('/ui', serverAdapter.getRouter());

// Redirect root to /ui
app.get('/', (_req, res) => {
  res.redirect('/ui');
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`📊 Bull-Board Queue Dashboard running on http://localhost:${PORT}/ui`);
  console.log(`   Monitoring: [${orderQueue.name}], [${orderDlqQueue.name}]`);
  console.log(`====================================================`);
});
