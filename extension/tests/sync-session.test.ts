import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContinuityDb, SyncItemRecord } from '../src/storage/db';
import { AuthExpiredError } from '../src/sync/errors';
import { createSyncSession } from '../src/sync/session';
import { createSyncStore, type SyncStore } from '../src/sync/store';
import { openTestDb } from './helpers';

const login = {
  userId: 'u1',
  email: 'a@example.com',
  accessToken: 'a',
  refreshToken: 'r',
  accessExpiresAt: 9e15,
};

const row: SyncItemRecord = {
  id: 'project:p1',
  kind: 'project',
  entityId: 'p1',
  parentId: null,
  status: 'synced',
  hash: 'h',
  serverVersion: null,
  error: null,
  updatedAt: 'x',
};

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let store: SyncStore;

beforeEach(() => {
  ({ db, cleanup } = openTestDb());
  store = createSyncStore(db);
});

afterEach(async () => {
  await cleanup();
});

function setup(result = login) {
  const logout = vi.fn(async () => undefined);
  const session = createSyncSession({
    store,
    auth: { login: async () => result, logout },
    now: () => 'NOW',
  });
  return { session, logout };
}

describe('sync session', () => {
  it('stores the session and remembers the account', async () => {
    const { session } = setup();
    expect(await session.signIn('a@example.com', 'pw')).toEqual({
      email: 'a@example.com',
      accountChanged: false,
    });
    expect(await store.getAuth()).toMatchObject({ userId: 'u1', refreshToken: 'r' });
    expect((await store.getConfig()).accountId).toBe('u1');
  });

  it('keeps synced items and the sync setting when the same account signs in again', async () => {
    await store.putItem(row);
    await store.updateConfig({ accountId: 'u1', enabled: true });
    await setup().session.signIn('a@example.com', 'pw');
    expect(await store.listItems()).toHaveLength(1);
    expect((await store.getConfig()).enabled).toBe(true);
  });

  it('clears synced items and turns sync off when a different account signs in', async () => {
    await store.putItem(row);
    await store.updateConfig({ accountId: 'u1', enabled: true, consentAt: 'old' });
    const result = await setup({ ...login, userId: 'u2', email: 'b@example.com' }).session.signIn(
      'b@example.com',
      'pw',
    );
    expect(result.accountChanged).toBe(true);
    expect(await store.listItems()).toEqual([]);
    expect(await store.getConfig()).toMatchObject({ accountId: 'u2', enabled: false, consentAt: null });
  });

  it('signs out: revokes, forgets the session and turns sync off', async () => {
    const { session, logout } = setup();
    await session.signIn('a@example.com', 'pw');
    await session.enableSync();
    await session.signOut();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await store.getAuth()).toBeUndefined();
    expect(await store.getConfig()).toMatchObject({ enabled: false, consentAt: null });
  });

  it('refuses to turn sync on without a session', async () => {
    await expect(setup().session.enableSync()).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('records consent when sync is turned on', async () => {
    const { session } = setup();
    await session.signIn('a@example.com', 'pw');
    await session.enableSync();
    expect(await store.getConfig()).toMatchObject({ enabled: true, consentAt: 'NOW' });
  });

  it('forgets consent when sync is turned off', async () => {
    const { session } = setup();
    await session.signIn('a@example.com', 'pw');
    await session.enableSync();
    await session.disableSync();
    expect(await store.getConfig()).toMatchObject({ enabled: false, consentAt: null });
  });
});