import type { CaptureStatus } from '../shared/messages';
import type { ProviderDefinition } from '../shared/providers';
import {
  deriveCaptureStatus,
  getProviderSettings,
  withProviderDisabled,
  withProviderEnabled,
} from '../shared/settings';
import type { SettingsStore } from '../shared/settings-store';

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'register_failed' };

export function hasProviderPermission(provider: ProviderDefinition): Promise<boolean> {
  return chrome.permissions.contains({ origins: [...provider.matches] });
}

async function isRegistered(provider: ProviderDefinition): Promise<boolean> {
  const found = await chrome.scripting.getRegisteredContentScripts({
    ids: [provider.contentScriptId],
  });
  return found.length > 0;
}

export async function unregisterContentScript(provider: ProviderDefinition): Promise<void> {
  if (await isRegistered(provider)) {
    await chrome.scripting.unregisterContentScripts({ ids: [provider.contentScriptId] });
  }
}

/** Always re-registers, so an updated extension never keeps a stale script path. */
export async function registerContentScript(provider: ProviderDefinition): Promise<void> {
  await unregisterContentScript(provider);
  await chrome.scripting.registerContentScripts([
    {
      id: provider.contentScriptId,
      matches: [...provider.matches],
      js: [provider.contentScriptFile],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

/** Registered scripts only affect pages loaded later, so also inject into tabs already open. */
async function injectIntoOpenTabs(provider: ProviderDefinition): Promise<void> {
  const tabs = await chrome.tabs.query({ url: [...provider.matches] });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [provider.contentScriptFile],
      });
    } catch {
      // Discarded or restricted tab: it will get the script on its next load.
    }
  }
}

export async function getCaptureStatus(
  provider: ProviderDefinition,
  store: SettingsStore,
): Promise<CaptureStatus> {
  const [hasPermission, settings] = await Promise.all([
    hasProviderPermission(provider),
    store.read(),
  ]);
  return deriveCaptureStatus({ hasPermission, ...getProviderSettings(settings, provider.id) });
}

/** Call directly from a click handler: the permission prompt needs a user gesture. */
export async function enableProvider(
  provider: ProviderDefinition,
  store: SettingsStore,
): Promise<EnableResult> {
  // Must be the first await in the click handler, or Chrome may refuse the request.
  const granted = await chrome.permissions.request({ origins: [...provider.matches] });
  if (!granted) return { ok: false, reason: 'denied' };

  try {
    await registerContentScript(provider);
  } catch (error) {
    console.error('Continuity: could not register content script', error);
    await chrome.permissions.remove({ origins: [...provider.matches] });
    return { ok: false, reason: 'register_failed' };
  }

  await store.update((s) => withProviderEnabled(s, provider.id, new Date().toISOString()));
  await injectIntoOpenTabs(provider);
  return { ok: true };
}

export async function disableProvider(
  provider: ProviderDefinition,
  store: SettingsStore,
): Promise<void> {
  await store.update((s) => withProviderDisabled(s, provider.id)); // flip to Off first
  await unregisterContentScript(provider);
  await chrome.permissions.remove({ origins: [...provider.matches] });
}

/** Brings Chrome's real state (permission, registered script) in line with our settings. */
export async function reconcileProvider(
  provider: ProviderDefinition,
  store: SettingsStore,
): Promise<void> {
  const [granted, settings] = await Promise.all([hasProviderPermission(provider), store.read()]);
  const enabled = getProviderSettings(settings, provider.id).enabled;

  if (enabled && granted) {
    await registerContentScript(provider);
    return;
  }
  if (enabled && !granted) {
    // The user revoked site access in Chrome: reflect that.
    await store.update((s) => withProviderDisabled(s, provider.id));
  }
  await unregisterContentScript(provider);
}