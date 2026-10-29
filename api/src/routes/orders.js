import express from 'express';
import { ORDER_STATUSES } from 'orderpilot-messenger-bot';
import { bot } from '../bot.js';
import { requireAdminKey } from '../middleware/adminAuth.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isOrderStatus = (value) => typeof value === 'string' && ORDER_STATUSES.includes(value);

const STATUS_ERROR = `status must be one of: ${ORDER_STATUSES.join(', ')}`;
const badRequest = (res, message) => res.status(400).json({ success: false, message });
const orderNotFound = (res) => res.status(404).json({ success: false, message: 'Order not found' });

// Admin-only order API over the orders the Messenger bot takes. Orders contain customer phone
// numbers and addresses, so the admin key is checked before anything else, even for unknown sub-paths.
export function createOrdersRouter({ store = bot.orders } = {}) {
  const router = express.Router();

  router.use(requireAdminKey);
  router.use(express.json({ limit: '10kb' }));

  // GET /api/orders?status=pending|confirmed|cancelled (newest first)
  // Handlers are async because the store may be Redis; Express 5 forwards rejections to the
  // error handler.
  router.get('/', async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !isOrderStatus(status)) {
      return badRequest(res, STATUS_ERROR);
    }
    const data = await store.list({ status });
    return res.json({ success: true, count: data.length, data });
  });

  router.get('/:id', async (req, res) => {
    const order = await store.get(req.params.id);
    if (!order) return orderNotFound(res);
    return res.json({ success: true, data: order });
  });

  // PATCH /api/orders/:id/status with body { "status": "confirmed" }
  router.patch('/:id/status', async (req, res) => {
    if (!isObject(req.body)) return badRequest(res, 'Request body must be a JSON object');
    if (!isOrderStatus(req.body.status)) {
      return badRequest(res, STATUS_ERROR);
    }
    const order = await store.updateStatus(req.params.id, req.body.status);
    if (!order) return orderNotFound(res);
    return res.json({ success: true, data: order });
  });

  return router;
}

export default createOrdersRouter();
