import type { HealthState } from '@/hooks/useHealth';
import { isApiError } from '@/services';

// Setup guidance shared by the topbar connection pill and the orders error alert.
export const GUIDANCE = {
  unauthorized: 'ADMIN_API_KEY in web/.env.local does not match the Express backend.',
  unreachable: 'Start the Express backend (cd api && pnpm dev) or check BACKEND_API_URL.',
  network: 'The dashboard server is not responding.',
} as const;

export type ConnectionTone = 'ok' | 'down' | 'neutral';

export type ConnectionView = {
  tone: ConnectionTone;
  label: string;
  detail: string;
};

// Reachability only: admin-key problems surface on the orders page alert.
export function describeConnection(state: HealthState): ConnectionView {
  if (state.kind === 'checking') {
    return { tone: 'neutral', label: 'Checking…', detail: 'Checking the connection to the Express backend.' };
  }

  if (state.kind === 'failed') {
    const { error } = state;
    const message = error instanceof Error && error.message ? error.message : 'Health check failed.';
    const backendDown = isApiError(error, 'BACKEND_UNREACHABLE') || isApiError(error, 'TIMEOUT');
    return { tone: 'down', label: 'Backend offline', detail: backendDown ? `${message} ${GUIDANCE.unreachable}` : message };
  }

  return { tone: 'ok', label: 'Connected', detail: `Express backend responded in ${state.health.latencyMs} ms.` };
}
