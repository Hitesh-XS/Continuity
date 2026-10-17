import { parseSettings, type Settings } from './settings';

export const SETTINGS_KEY = 'settings';

/** The small slice of chrome.storage.* that we use, so tests can fake it. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function getLocks(): LockManagerLike | undefined {
  return (globalThis as unknown as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
}

export function createSettingsStore(area: StorageAreaLike) {
  // Serializes updates inside this JS context...
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Settings> {
    const stored = await area.get(SETTINGS_KEY);
    return parseSettings(stored[SETTINGS_KEY]);
  }

  async function readModifyWrite(mutator: (current: Settings) => Settings): Promise<Settings> {
    const current = await read();
    const next = parseSettings(mutator(current));
    await area.set({ [SETTINGS_KEY]: next });
    return next;
  }

  /** ...and navigator.locks serializes across the panel and service worker. */
  function update(mutator: (current: Settings) => Settings): Promise<Settings> {
    const run = (): Promise<Settings> => {
      const locks = getLocks();
      return locks
        ? locks.request('continuity-settings', () => readModifyWrite(mutator))
        : readModifyWrite(mutator);
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  return { read, update };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
