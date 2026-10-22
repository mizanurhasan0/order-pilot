'use client';

import { useEffect, useState } from 'react';
import type { HealthStatus } from '@/lib/types';
import { healthService, isCanceled } from '@/services';

const POLL_MS = 30_000;
// Focus events arrive in bursts (alt-tab, devtools); skip checks right after another.
const MIN_GAP_MS = 3_000;

export type HealthState =
  | { kind: 'checking' }
  | { kind: 'ready'; health: HealthStatus }
  | { kind: 'failed'; error: unknown };

// Whether the Express backend answers GET /health, and how fast. Checks every 30 s
// while the tab is visible and on window focus; checks never overlap and are
// aborted on unmount.
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ kind: 'checking' });

  useEffect(() => {
    let controller: AbortController | null = null;
    let lastStartedAt = 0;

    const check = async () => {
      if (controller || Date.now() - lastStartedAt < MIN_GAP_MS) return;
      lastStartedAt = Date.now();
      const current = new AbortController();
      controller = current;
      try {
        const health = await healthService.check(current.signal);
        if (!current.signal.aborted) setState({ kind: 'ready', health });
      } catch (error) {
        if (!current.signal.aborted && !isCanceled(error)) setState({ kind: 'failed', error });
      } finally {
        if (controller === current) controller = null;
      }
    };

    const onFocus = () => void check();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);

    void check();
    window.addEventListener('focus', onFocus);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return state;
}
