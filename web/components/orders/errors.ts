import { isApiError } from '@/services';
import { GUIDANCE } from '@/components/shell/connection';

export type ErrorCopy = { title: string; detail: string };

export const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something unexpected happened.';

// Turns a failed orders request into something the merchant can act on.
export function describeOrdersError(error: unknown): ErrorCopy {
  const code = isApiError(error) ? error.code : null;
  switch (code) {
    case 'NOT_CONFIGURED':
      // proxy.ts names the exact setting (ADMIN_API_KEY or BACKEND_API_URL).
      return { title: 'Dashboard is not configured', detail: errorMessage(error) };
    case 'UNAUTHORIZED':
      return { title: 'Admin key rejected', detail: GUIDANCE.unauthorized };
    case 'BACKEND_UNREACHABLE':
    case 'TIMEOUT':
      return { title: errorMessage(error), detail: GUIDANCE.unreachable };
    case 'NETWORK':
      return { title: errorMessage(error), detail: GUIDANCE.network };
    default:
      // FORBIDDEN, BAD_REQUEST, SERVER_ERROR: the message already says what went wrong.
      return { title: 'Could not load orders', detail: errorMessage(error) };
  }
}
