// Express order routes (admin key added by proxy.ts).
import type { Order, OrderList, OrderStatus } from '@/lib/types';
import { request } from './http';

const orderPath = (id: string) => `/api/orders/${encodeURIComponent(id)}`;

export const orderService = {
  // GET /api/orders?status= (newest first)
  list: (params: { status?: OrderStatus } = {}, signal?: AbortSignal) =>
    request<OrderList>({ method: 'GET', url: '/api/orders', params, signal }),

  // GET /api/orders/:id
  getById: async (id: string, signal?: AbortSignal): Promise<Order> =>
    (await request<{ data: Order }>({ method: 'GET', url: orderPath(id), signal })).data,

  // PATCH /api/orders/:id/status
  updateStatus: async (id: string, status: OrderStatus): Promise<Order> =>
    (await request<{ data: Order }>({ method: 'PATCH', url: `${orderPath(id)}/status`, data: { status } })).data,
};
