import { useCallback, useEffect, useState } from 'react';
import { hasProviderPermission } from '../../src/extension/capture-control';
import { TabStatusSchema, tabStatusKey, type TabStatus } from '../../src/shared/messages';
import type { ProviderDefinition } from '../../src/shared/providers';
import type { Settings } from '../../src/shared/settings';
import { SETTINGS_KEY } from '../../src/shared/settings-store';
import type { LocalProject } from '../../src/storage/db';
import { projectRepo, settingsStore } from './services';

type StorageChanges = { [key: string]: chrome.storage.StorageChange };

export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      void settingsStore.read().then((value) => {
        if (active) setSettings(value);
      });
    };
    const onChanged = (changes: StorageChanges, area: string): void => {
      if (area === 'local' && SETTINGS_KEY in changes) load();
    };
    load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return settings;
}

/** null while loading; then whether Chrome currently grants site access. */
export function useProviderPermission(provider: ProviderDefinition): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = (): void => {
      void hasProviderPermission(provider).then((value) => {
        if (active) setGranted(value);
      });
    };
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      active = false;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [provider]);

  return granted;
}

/** The "page script is alive" record for the active tab, if any. */
export function useActiveTabStatus(): TabStatus | null {
  const [status, setStatus] = useState<TabStatus | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) {
          if (active) setStatus(null);
          return;
        }
        const key = tabStatusKey(tab.id);
        const stored = await chrome.storage.session.get(key);
        const parsed = TabStatusSchema.safeParse(stored[key]);
        if (active) setStatus(parsed.success ? parsed.data : null);
      } catch {
        if (active) setStatus(null);
      }
    };
    const onChange = (): void => {
      void load();
    };
    onChange();
    chrome.tabs.onActivated.addListener(onChange);
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      active = false;
      chrome.tabs.onActivated.removeListener(onChange);
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  return status;
}

/** Always loads every project (including archived); components filter. */
export function useProjects() {
  const [projects, setProjects] = useState<LocalProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setProjects(await projectRepo.list({ includeArchived: true }));
      setError(null);
    } catch (e) {
      console.error('Continuity: could not read projects', e);
      setError('Could not read projects from this browser.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, error, refresh };
}