import { assertSafeBaseUrl } from '../shared/api-config';
import { ApiError, AuthExpiredError, NetworkError } from './errors';
import { withLock } from './locks';
import type { SyncStore } from './store';

export interface ApiResult {
  status: number;
  data: unknown;
}

export interface LoginResult {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

const REQUEST_TIMEOUT_MS = 20_000;
const EXPIRY_MARGIN_MS = 30_000;

/** Reads only the expiry time from a JWT. The server, not this, decides whether a token is valid. */
export function jwtExpiryMs(token: string, nowMs: number): number {
  try {
    const part = token.split('.')[1];
    if (!part) throw new Error('no payload');
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000;
  } catch {
    // fall through to the fallback
  }
  return nowMs + 5 * 60_000;
}

function toApiError(status: number, data: unknown): ApiError {
  const error = (data as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)
    ?.error;
  const code = typeof error?.code === 'string' ? error.code : 'http_error';
  const message = typeof error?.message === 'string' ? error.message : `HTTP ${status}`;
  const retry = (error?.details as { retry_after_seconds?: unknown } | null | undefined)
    ?.retry_after_seconds;
  return new ApiError(status, code, message, typeof retry === 'number' ? retry : undefined);
}

export interface ApiClientDeps {
  baseUrl: string;
  store: Pick<SyncStore, 'getAuth' | 'setAuth' | 'clearAuth'>;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createApiClient(deps: ApiClientDeps) {
  const origin = assertSafeBaseUrl(deps.baseUrl).origin;
  const fetchFn: typeof fetch = deps.fetchFn ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const { store } = deps;

  async function rawRequest(
    method: string,
    path: string,
    options: { body?: unknown; token?: string | undefined } = {},
  ): Promise<ApiResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      response = await fetchFn(new URL(path, origin).toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'omit', // tokens only, never cookies
        cache: 'no-store',
        redirect: 'error', // never follow a redirect with our token attached
        signal: controller.signal,
      });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }

    let data: unknown = null;
    if (response.status !== 204) {
      try {
        data = await response.json();
      } catch {
        data = null; // e.g. an HTML error page from a proxy
      }
    }
    if (!response.ok) throw toApiError(response.status, data);
    return { status: response.status, data };
  }

  async function refreshIfNeeded(staleToken?: string): Promise<string> {
    // Re-read inside the lock: another window may already have refreshed.
    const auth = await store.getAuth();
    if (!auth) throw new AuthExpiredError();
    const fresh = auth.accessExpiresAt - now() > EXPIRY_MARGIN_MS;
    if (fresh && auth.accessToken !== staleToken) return auth.accessToken;

    let result: ApiResult;
    try {
      result = await rawRequest('POST', '/api/v1/auth/token/refresh/', {
        body: { refresh: auth.refreshToken },
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
        await store.clearAuth();
        throw new AuthExpiredError();
      }
      throw error;
    }
    const { access, refresh } = (result.data ?? {}) as { access?: unknown; refresh?: unknown };
    if (typeof access !== 'string' || typeof refresh !== 'string') {
      throw new ApiError(502, 'bad_refresh_response', 'Unexpected refresh response');
    }
    await store.setAuth({
      ...auth,
      accessToken: access,
      refreshToken: refresh,
      accessExpiresAt: jwtExpiryMs(access, now()),
    });
    return access;
  }

  // Refresh tokens rotate: two refreshes with the same token would sign the user out.
  // One in-flight promise covers this window; the Web Lock covers other extension windows.
  let inflight: Promise<string> | null = null;
  function getAccessToken(staleToken?: string): Promise<string> {
    if (inflight) return inflight;
    const promise = withLock('continuity-auth-refresh', () => refreshIfNeeded(staleToken));
    inflight = promise;
    const clear = (): void => {
      if (inflight === promise) inflight = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  /** An authenticated request. Refreshes the access token as needed, at most once per call. */
  async function request(method: string, path: string, body?: unknown): Promise<ApiResult> {
    const token = await getAccessToken();
    try {
      return await rawRequest(method, path, { body, token });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    const renewed = await getAccessToken(token);
    try {
      return await rawRequest(method, path, { body, token: renewed });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await store.clearAuth();
        throw new AuthExpiredError();
      }
      throw error;
    }
  }

  async function login(email: string, password: string): Promise<LoginResult> {
    const tokens = await rawRequest('POST', '/api/v1/auth/token/', { body: { email, password } });
    const { access, refresh } = (tokens.data ?? {}) as { access?: unknown; refresh?: unknown };
    if (typeof access !== 'string' || typeof refresh !== 'string') {
      throw new ApiError(502, 'bad_login_response', 'Unexpected login response');
    }
    const me = await rawRequest('GET', '/api/v1/account/me/', { token: access });
    const profile = (me.data ?? {}) as { id?: unknown; email?: unknown };
    if (typeof profile.id !== 'string' || typeof profile.email !== 'string') {
      throw new ApiError(502, 'bad_profile_response', 'Unexpected profile response');
    }
    return {
      userId: profile.id,
      email: profile.email,
      accessToken: access,
      refreshToken: refresh,
      accessExpiresAt: jwtExpiryMs(access, now()),
    };
  }

  /** Revokes the refresh token on the server (best effort), then forgets the session locally. */
  async function logout(): Promise<void> {
    const auth = await store.getAuth();
    if (auth) {
      try {
        await rawRequest('POST', '/api/v1/auth/logout/', { body: { refresh: auth.refreshToken } });
      } catch {
        // Offline or already revoked: the local session is removed either way.
      }
    }
    await store.clearAuth();
  }

  return { request, login, logout };
}

export type ApiClient = ReturnType<typeof createApiClient>;