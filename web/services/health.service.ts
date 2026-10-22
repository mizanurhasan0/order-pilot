// Express GET /health.
import type { HealthStatus } from '@/lib/types';
import { http } from './http';

export const healthService = {
  // Resolves when Express answers; rejects with an ApiError otherwise.
  async check(signal?: AbortSignal): Promise<HealthStatus> {
    const started = performance.now();
    await http.get('/health', { signal });
    return { latencyMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString() };
  },
};
