import type {
  AuthRecord,
  ContinuityDb,
  SyncConfigRecord,
  SyncItemRecord,
} from '../storage/db';

const AUTH_KEY = 'session' as const;
const CONFIG_KEY = 'config' as const;

export function defaultConfig(): SyncConfigRecord {
  return {
    key: CONFIG_KEY,
    enabled: false,
    consentAt: null,
    accountId: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  };
}

export function createSyncStore(db: ContinuityDb) {
  return {
    getAuth: (): Promise<AuthRecord | undefined> => db.auth.get(AUTH_KEY),
    async setAuth(record: AuthRecord): Promise<void> {
      await db.auth.put(record);
    },
    clearAuth: (): Promise<void> => db.auth.delete(AUTH_KEY),

    async getConfig(): Promise<SyncConfigRecord> {
      return (await db.syncConfig.get(CONFIG_KEY)) ?? defaultConfig();
    },
    updateConfig(patch: Partial<Omit<SyncConfigRecord, 'key'>>): Promise<SyncConfigRecord> {
      return db.transaction('rw', db.syncConfig, async () => {
        const current = (await db.syncConfig.get(CONFIG_KEY)) ?? defaultConfig();
        const next: SyncConfigRecord = { ...current, ...patch, key: CONFIG_KEY };
        await db.syncConfig.put(next);
        return next;
      });
    },

    listItems: (): Promise<SyncItemRecord[]> => db.syncItems.toArray(),
    getItem: (id: string): Promise<SyncItemRecord | undefined> => db.syncItems.get(id),
    async putItem(item: SyncItemRecord): Promise<void> {
      await db.syncItems.put(item);
    },
    deleteItem: (id: string): Promise<void> => db.syncItems.delete(id),
    async deleteItemsByParent(parentId: string): Promise<void> {
      await db.syncItems.where('parentId').equals(parentId).delete();
    },
    async deleteFailedItems(): Promise<void> {
      await db.syncItems.where('status').equals('failed').delete();
    },
    clearItems: (): Promise<void> => db.syncItems.clear(),
  };
}

export type SyncStore = ReturnType<typeof createSyncStore>;