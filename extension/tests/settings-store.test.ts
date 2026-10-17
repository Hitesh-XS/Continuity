import { describe, expect, it } from 'vitest';
import { defaultSettings, withActiveProject, withProviderEnabled } from '../src/shared/settings';
import {
  SETTINGS_KEY,
  createSettingsStore,
  type StorageAreaLike,
} from '../src/shared/settings-store';

const NOW = '2026-10-17T10:00:00.000Z';

function memoryArea(initial: Record<string, unknown> = {}): StorageAreaLike {
  const data: Record<string, unknown> = { ...initial };
  return {
    async get(key) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      Object.assign(data, items);
    },
  };
}

describe('settings store', () => {
  it('reads defaults when nothing is stored', async () => {
    const store = createSettingsStore(memoryArea());
    expect(await store.read()).toEqual(defaultSettings());
  });

  it('persists updates', async () => {
    const area = memoryArea();
    const projectId = crypto.randomUUID();
    const next = await createSettingsStore(area).update((s) => withActiveProject(s, projectId));
    expect(next.activeProjectId).toBe(projectId);
    // A brand-new store over the same storage sees it, like a restarted service worker.
    expect((await createSettingsStore(area).read()).activeProjectId).toBe(projectId);
  });

  it('resets corrupted stored data to defaults', async () => {
    const store = createSettingsStore(memoryArea({ [SETTINGS_KEY]: { schemaVersion: 99 } }));
    expect(await store.read()).toEqual(defaultSettings());
  });

  it('applies concurrent updates without losing either', async () => {
    const store = createSettingsStore(memoryArea());
    const projectId = crypto.randomUUID();
    await Promise.all([
      store.update((s) => withProviderEnabled(s, 'claude', NOW)),
      store.update((s) => withActiveProject(s, projectId)),
    ]);
    const final = await store.read();
    expect(final.providers.claude?.enabled).toBe(true);
    expect(final.activeProjectId).toBe(projectId);
  });

  it('keeps working after a mutator throws', async () => {
    const store = createSettingsStore(memoryArea());
    await expect(
      store.update(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const projectId = crypto.randomUUID();
    const next = await store.update((s) => withActiveProject(s, projectId));
    expect(next.activeProjectId).toBe(projectId);
  });
});