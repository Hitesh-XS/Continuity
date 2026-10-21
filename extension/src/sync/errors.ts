export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The server could not be reached at all (offline, server down, timeout). */
export class NetworkError extends Error {
  constructor(message = 'network') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The session is gone and cannot be refreshed: the user must sign in again. */
export class AuthExpiredError extends Error {
  constructor() {
    super('session expired');
    this.name = 'AuthExpiredError';
  }
}

/** Worth retrying later without changing anything. */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return (
    error instanceof ApiError &&
    (error.status === 408 || error.status === 429 || error.status >= 500)
  );
}