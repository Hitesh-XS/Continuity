import { useCallback, useEffect, useState } from 'react';
import type { ZodType } from 'zod';
import { hasProviderPermission } from '../../src/extension/capture-control';
import {
  AdapterHealthRecordSchema,
  CAPTURE_TICK_KEY,
  TabStatusSchema,
  adapterHealthKey,
  tabStatusKey,
  type AdapterHealthRecord,
  type TabStatus,
} from '../../src/shared/messages';
import type { ProviderDefinition } from '../../src/shared/providers';
import type { Settings } from '../../src/shared/settings';
import { SETTINGS_KEY } from '../../src/shared/settings-store';
import type { LocalCheckpoint, LocalConversation, LocalProject } from '../../src/storage/db';
import { checkpointRepo, conversationRepo, projectRepo, settingsStore } from './services';

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

/** A per-tab record from session storage for the tab the user is looking at. */
function useActiveTabRecord<T>(keyFor: (tabId: number) => string, schema: ZodType<T>): T | null {
  const [record, setRecord] = useState<T | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) {
          if (active) setRecord(null);
          return;
        }
        const key = keyFor(tab.id);
        const stored = await chrome.storage.session.get(key);
        const parsed = schema.safeParse(stored[key]);
        if (active) setRecord(parsed.success ? parsed.data : null);
      } catch {
        if (active) setRecord(null);
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
  }, [keyFor, schema]);

  return record;
}

export function useActiveTabStatus(): TabStatus | null {
  return useActiveTabRecord(tabStatusKey, TabStatusSchema);
}

export function useAdapterHealth(): AdapterHealthRecord | null {
  return useActiveTabRecord(adapterHealthKey, AdapterHealthRecordSchema);
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

/** Captured conversations, refreshed whenever the service worker stores new content. */
export function useConversations() {
  const [conversations, setConversations] = useState<LocalConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setConversations(await conversationRepo.list());
      setError(null);
    } catch (e) {
      console.error('Continuity: could not read conversations', e);
      setError('Could not read captured conversations from this browser.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = (changes: StorageChanges, area: string): void => {
      if (area === 'session' && CAPTURE_TICK_KEY in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  return { conversations, error, refresh };
}

/** Checkpoints of one project, newest first. null while loading or when the project just changed. */
export function useCheckpoints(projectId: string | null) {
  const [state, setState] = useState<{ projectId: string | null; list: LocalCheckpoint[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setState({ projectId, list: [] });
      return;
    }
    try {
      setState({ projectId, list: await checkpointRepo.list(projectId) });
      setError(null);
    } catch (e) {
      console.error('Continuity: could not read checkpoints', e);
      setError('Could not read checkpoints from this browser.');
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Ignore a result that belongs to a previously selected project.
  const checkpoints = state && state.projectId === projectId ? state.list : null;

  return { checkpoints, error, refresh };
}