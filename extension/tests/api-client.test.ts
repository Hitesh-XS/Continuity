import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContinuityDb } from '../src/storage/db';
import { createApiClient, jwtExpiryMs } from '../src/sync/api-client';
import { ApiError, AuthExpiredError, NetworkError, isTransient } from '../src/sync/errors';
import { createSyncStore, type SyncStore } from '../src/sync/store';
import { openTestDb } from './helpers';

const NOW = 1_000_000_000; // milliseconds
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function jwt(expSeconds: number): string {
  const enc = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: expSeconds })}.sig`;
}

interface Logged {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  init: RequestInit | undefined;
}

function makeFetch(handler: (req: Logged) => Response | Promise<Response>) {
  const log: Logged[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const entry: Logged = {
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      init,
    };
    log.push(entry);
    return handler(entry);
  }) as typeof fetch;
  return { fetchFn, log };
}

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let store: SyncStore;

beforeEach(async () => {
  ({ db, cleanup } = openTestDb());
  store = createSyncStore(db);
});

afterEach(async () => {
  await cleanup();
});

async function signedIn(accessExpiresAt = NOW + 900_000): Promise<void> {
  await store.setAuth({
    key: 'session',
    userId: 'u1',
    email: 'a@example.com',
    accessToken: 'a1',
    accessExpiresAt,
    refreshToken: 'r1',
  });
}

const clientFor = (fetchFn: typeof fetch) =>
  createApiClient({ baseUrl: 'http://127.0.0.1:8000', store, fetchFn, now: () => NOW });

describe('login', () => {
  it('returns tokens and the account, sending no token on the login call itself', async () => {
    const access = jwt(NOW / 1000 + 900);
    const { fetchFn, log } = makeFetch((req) =>
      req.path === '/api/v1/auth/token/'
        ? json(200, { access, refresh: 'r1' })
        : json(200, { id: 'u1', email: 'a@example.com' }),
    );
    const result = await clientFor(fetchFn).login('a@example.com', 'pw');
    expect(result).toEqual({
      userId: 'u1',
      email: 'a@example.com',
      accessToken: access,
      refreshToken: 'r1',
      accessExpiresAt: (NOW / 1000 + 900) * 1000,
    });
    expect(log[0]?.headers.Authorization).toBeUndefined();
    expect(log[1]?.headers.Authorization).toBe(`Bearer ${access}`);
    expect(await store.getAuth()).toBeUndefined(); // storing is the session's job
  });

  it('surfaces the server error for a wrong password', async () => {
    const { fetchFn } = makeFetch(() =>
      json(401, { error: { code: 'no_active_account', message: 'No active account' } }),
    );
    const error = await clientFor(fetchFn).login('a@example.com', 'bad').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'no_active_account' });
  });
});

describe('authenticated requests', () => {
  it('sends the bearer token, no cookies, and refuses redirects', async () => {
    await signedIn();
    const { fetchFn, log } = makeFetch(() => json(200, { ok: true }));
    await clientFor(fetchFn).request('GET', '/api/v1/account/me/');
    expect(log[0]?.headers.Authorization).toBe('Bearer a1');
    expect(log[0]?.init?.credentials).toBe('omit');
    expect(log[0]?.init?.redirect).toBe('error');
  });

  it('refreshes an expired access token first and stores the rotated refresh token', async () => {
    await signedIn(NOW - 1);
    const access = jwt(NOW / 1000 + 900);
    const { fetchFn, log } = makeFetch((req) =>
      req.path === '/api/v1/auth/token/refresh/'
        ? json(200, { access, refresh: 'r2' })
        : json(200, { ok: true }),
    );
    await clientFor(fetchFn).request('GET', '/api/v1/account/me/');
    expect(log.map((entry) => entry.path)).toEqual([
      '/api/v1/auth/token/refresh/',
      '/api/v1/account/me/',
    ]);
    expect(log[0]?.body).toEqual({ refresh: 'r1' });
    expect(log[1]?.headers.Authorization).toBe(`Bearer ${access}`);
    expect(await store.getAuth()).toMatchObject({ accessToken: access, refreshToken: 'r2' });
  });

  it('retries once with a refreshed token after a 401', async () => {
    await signedIn();
    const { fetchFn, log } = makeFetch((req) => {
      if (req.path === '/api/v1/auth/token/refresh/') return json(200, { access: 'a2', refresh: 'r2' });
      return req.headers.Authorization === 'Bearer a1'
        ? json(401, { error: { code: 'token_not_valid', message: 'expired' } })
        : json(200, { ok: true });
    });
    const result = await clientFor(fetchFn).request('GET', '/api/v1/account/me/');
    expect(result.status).toBe(200);
    expect(log.filter((entry) => entry.path === '/api/v1/auth/token/refresh/')).toHaveLength(1);
    expect(log.filter((entry) => entry.path === '/api/v1/account/me/')).toHaveLength(2);
  });

  it('signs the user out when the refresh token is rejected', async () => {
    await signedIn(NOW - 1);
    const { fetchFn } = makeFetch(() =>
      json(401, { error: { code: 'token_not_valid', message: 'bad token' } }),
    );
    await expect(clientFor(fetchFn).request('GET', '/api/v1/account/me/')).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
    expect(await store.getAuth()).toBeUndefined();
  });

  it('refreshes only once for simultaneous requests', async () => {
    await signedIn(NOW - 1);
    let refreshes = 0;
    const { fetchFn } = makeFetch(async (req) => {
      if (req.path === '/api/v1/auth/token/refresh/') {
        refreshes += 1;
        await Promise.resolve();
        return json(200, { access: 'a2', refresh: 'r2' });
      }
      return json(200, { ok: true });
    });
    const client = clientFor(fetchFn);
    const results = await Promise.all([
      client.request('GET', '/api/v1/account/me/'),
      client.request('GET', '/api/v1/projects/'),
    ]);
    expect(refreshes).toBe(1);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
  });

  it('signs out when a freshly refreshed token is still rejected', async () => {
    await signedIn();
    const { fetchFn } = makeFetch((req) =>
      req.path === '/api/v1/auth/token/refresh/'
        ? json(200, { access: 'a2', refresh: 'r2' })
        : json(401, { error: { code: 'token_not_valid', message: 'no' } }),
    );
    await expect(clientFor(fetchFn).request('GET', '/api/v1/account/me/')).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
    expect(await store.getAuth()).toBeUndefined();
  });

  it('fails with AuthExpiredError when there is no session', async () => {
    const { fetchFn } = makeFetch(() => json(200, {}));
    await expect(clientFor(fetchFn).request('GET', '/api/v1/account/me/')).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
  });
});

describe('error handling', () => {
  it('reports an unreachable server as a transient NetworkError', async () => {
    await signedIn();
    const fetchFn = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const error = await clientFor(fetchFn).request('GET', '/api/v1/projects/').catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(isTransient(error)).toBe(true);
  });

  it('treats a 5xx as transient', async () => {
    await signedIn();
    const { fetchFn } = makeFetch(() => json(503, { error: { code: 'unavailable', message: 'down' } }));
    const error = await clientFor(fetchFn).request('GET', '/api/v1/projects/').catch((e) => e);
    expect(error).toMatchObject({ status: 503, code: 'unavailable' });
    expect(isTransient(error)).toBe(true);
  });

  it('carries retry-after for a 429', async () => {
    await signedIn();
    const { fetchFn } = makeFetch(() =>
      json(429, { error: { code: 'throttled', message: 'slow down', details: { retry_after_seconds: 12 } } }),
    );
    const error = await clientFor(fetchFn).request('GET', '/api/v1/projects/').catch((e) => e);
    expect(error).toMatchObject({ status: 429, code: 'throttled', retryAfterSeconds: 12 });
  });

  it('tolerates a non-JSON error body', async () => {
    await signedIn();
    const { fetchFn } = makeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await clientFor(fetchFn).request('GET', '/api/v1/projects/').catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: 'http_error' });
  });

  it('returns null data for a 204', async () => {
    await signedIn();
    const { fetchFn } = makeFetch(() => new Response(null, { status: 204 }));
    expect(await clientFor(fetchFn).request('DELETE', '/api/v1/projects/x/')).toEqual({
      status: 204,
      data: null,
    });
  });
});

describe('logout', () => {
  it('revokes the refresh token and forgets the session even if the server call fails', async () => {
    await signedIn();
    const { fetchFn, log } = makeFetch(() => json(500, { error: { code: 'server_error', message: 'x' } }));
    await clientFor(fetchFn).logout();
    expect(log[0]?.path).toBe('/api/v1/auth/logout/');
    expect(log[0]?.body).toEqual({ refresh: 'r1' });
    expect(await store.getAuth()).toBeUndefined();
  });
});

describe('jwtExpiryMs', () => {
  it('reads the exp claim', () => {
    expect(jwtExpiryMs(jwt(2000), 0)).toBe(2_000_000);
  });

  it('falls back to five minutes from now for an unreadable token', () => {
    expect(jwtExpiryMs('abc', 100)).toBe(100 + 300_000);
  });
});