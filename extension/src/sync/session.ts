import { AuthExpiredError } from './errors';
import type { LoginResult } from './api-client';
import type { SyncStore } from './store';

export interface AuthApi {
  login(email: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
}

export function createSyncSession(deps: { store: SyncStore; auth: AuthApi; now?: () => string }) {
  const { store, auth } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  async function signIn(
    email: string,
    password: string,
  ): Promise<{ email: string; accountChanged: boolean }> {
    const result = await auth.login(email, password);
    const config = await store.getConfig();
    // Sync records describe ONE server account. A different account starts from nothing.
    const accountChanged = config.accountId !== null && config.accountId !== result.userId;
    if (accountChanged) await store.clearItems();
    await store.setAuth({
      key: 'session',
      userId: result.userId,
      email: result.email,
      accessToken: result.accessToken,
      accessExpiresAt: result.accessExpiresAt,
      refreshToken: result.refreshToken,
    });
    await store.updateConfig({
      accountId: result.userId,
      ...(accountChanged ? { enabled: false, consentAt: null, lastResult: null, lastError: null } : {}),
    });
    return { email: result.email, accountChanged };
  }

  async function signOut(): Promise<void> {
    await auth.logout().catch(() => undefined);
    await store.clearAuth();
    await store.updateConfig({ enabled: false, consentAt: null });
  }

  async function enableSync(): Promise<void> {
    if (!(await store.getAuth())) throw new AuthExpiredError();
    await store.updateConfig({ enabled: true, consentAt: now(), lastResult: null, lastError: null });
  }

  async function disableSync(): Promise<void> {
    await store.updateConfig({ enabled: false, consentAt: null });
  }

  return { signIn, signOut, enableSync, disableSync };
}

export type SyncSession = ReturnType<typeof createSyncSession>;