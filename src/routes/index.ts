import { Router } from 'express';
import orderRoutes from './order.routes.js';

const apiRouter = Router();

apiRouter.use('/orders', orderRoutes);

export default apiRouter;

