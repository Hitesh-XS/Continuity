import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { SyncConfigRecord, SyncItemRecord } from '../../src/storage/db';
import { planSize } from '../../src/sync/engine';
import { defaultConfig } from '../../src/sync/store';
import { db, syncEngine, syncStore } from './services';

export interface SyncStatus {
  loaded: boolean;
  email: string | null;
  config: SyncConfigRecord;
  pending: number;
  failed: number;
}

/** Sign-in state, sync settings and how much is waiting. Refreshes when the data changes. */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    loaded: false,
    email: null,
    config: defaultConfig(),
    pending: 0,
    failed: 0,
  });

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const [auth, config, plan] = await Promise.all([
          syncStore.getAuth(),
          syncStore.getConfig(),
          syncEngine.plan(),
        ]);
        if (active) {
          setStatus({
            loaded: true,
            email: auth?.email ?? null,
            config,
            pending: planSize(plan),
            failed: plan.failed,
          });
        }
      } catch (e) {
        console.error('Continuity: could not read sync status', e instanceof Error ? e.name : 'Error');
      }
    };
    const subscription = liveQuery(async () => ({
      auth: (await db.auth.get('session'))?.userId ?? null,
      config: (await db.syncConfig.get('config')) ?? null,
      items: await db.syncItems.count(),
      projects: await db.projects.count(),
      projectsChangedAt: (await db.projects.orderBy('updatedAt').last())?.updatedAt ?? '',
      checkpoints: await db.checkpoints.count(),
    })).subscribe({ next: () => void refresh(), error: () => undefined });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return status;
}

/** Which checkpoints and projects the server has, for badges. */
export function useSyncItemMap(): Map<string, SyncItemRecord> {
  const [items, setItems] = useState<Map<string, SyncItemRecord>>(new Map());
  useEffect(() => {
    const subscription = liveQuery(() => db.syncItems.toArray()).subscribe({
      next: (rows) => setItems(new Map(rows.map((row) => [row.id, row] as const))),
      error: () => undefined,
    });
    return () => subscription.unsubscribe();
  }, []);
  return items;
}

/** Runs a sync shortly after local data changes, every minute, and when the panel regains focus. */
export function useAutoSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trigger = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        syncEngine.run().catch((e) => console.error('Continuity: sync run failed', e?.name ?? 'Error'));
      }, 1500);
    };
    const subscription = liveQuery(
      async () =>
        `${await db.projects.count()}|${(await db.projects.orderBy('updatedAt').last())?.updatedAt ?? ''}|${await db.checkpoints.count()}`,
    ).subscribe({ next: trigger, error: () => undefined });
    const interval = setInterval(trigger, 60_000);
    window.addEventListener('focus', trigger);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('focus', trigger);
      subscription.unsubscribe();
    };
  }, []);
}