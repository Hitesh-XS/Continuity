import { localArea } from '../src/extension/chrome-storage';
import { getCaptureStatus, reconcileProvider } from '../src/extension/capture-control';
import { tabStatusKey } from '../src/shared/messages';
import { PROVIDERS } from '../src/shared/providers';
import { routeMessage } from '../src/shared/router';
import { createSettingsStore } from '../src/shared/settings-store';

export default defineBackground(() => {
  // All chrome.* usage stays inside this function: WXT also loads this file in Node at build time.
  const settingsStore = createSettingsStore(localArea);

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Continuity: side panel setup failed', error));

  const reconcileAll = (): void => {
    for (const provider of PROVIDERS) {
      reconcileProvider(provider, settingsStore).catch((error) =>
        console.error('Continuity: reconcile failed', error),
      );
    }
  };
  chrome.runtime.onInstalled.addListener(reconcileAll);
  chrome.runtime.onStartup.addListener(reconcileAll);
  chrome.permissions.onRemoved.addListener(reconcileAll);

  // Forget a tab's status when it closes or starts loading a new page.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(tabStatusKey(tabId));
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') void chrome.storage.session.remove(tabStatusKey(tabId));
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    routeMessage(message, sender, {
      extensionId: chrome.runtime.id,
      getCaptureStatus: (provider) => getCaptureStatus(provider, settingsStore),
      saveTabStatus: (tabId, status) =>
        chrome.storage.session.set({ [tabStatusKey(tabId)]: status }),
      now: () => new Date().toISOString(),
    })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'internal' }));
    return true; // keep the channel open for the async response
  });
});