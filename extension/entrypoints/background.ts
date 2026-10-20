import { createCaptureStore } from '../src/capture/ingest';
import { localArea } from '../src/extension/chrome-storage';
import { getCaptureStatus, reconcileProvider } from '../src/extension/capture-control';
import { CAPTURE_TICK_KEY, adapterHealthKey, tabStatusKey } from '../src/shared/messages';
import { PROVIDERS } from '../src/shared/providers';
import { routeMessage } from '../src/shared/router';
import { createSettingsStore } from '../src/shared/settings-store';
import { createDb } from '../src/storage/db';

export default defineBackground(() => {
  // All chrome.* usage stays inside this function: WXT also loads this file in Node at build time.
  const settingsStore = createSettingsStore(localArea);
  const db = createDb(); // the extension's own IndexedDB, not any website's
  const captureStore = createCaptureStore(db);

  const enablePanelOnActionClick = (attempt = 0): void => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
      if (attempt < 3) {
        // The service worker can still be starting: try again shortly.
        setTimeout(() => enablePanelOnActionClick(attempt + 1), 500 * (attempt + 1));
        return;
      }
      console.error('Continuity: side panel setup failed', error);
    });
  };
  enablePanelOnActionClick();
  chrome.runtime.onInstalled.addListener(() => enablePanelOnActionClick());
  chrome.runtime.onStartup.addListener(() => enablePanelOnActionClick());

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

  const forgetTab = (tabId: number): void => {
    void chrome.storage.session.remove([tabStatusKey(tabId), adapterHealthKey(tabId)]);
  };
  chrome.tabs.onRemoved.addListener(forgetTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') forgetTab(tabId);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    routeMessage(message, sender, {
      extensionId: chrome.runtime.id,
      getCaptureStatus: (provider) => getCaptureStatus(provider, settingsStore),
      saveTabStatus: (tabId, status) =>
        chrome.storage.session.set({ [tabStatusKey(tabId)]: status }),
      saveAdapterHealth: (tabId, record) =>
        chrome.storage.session.set({ [adapterHealthKey(tabId)]: record }),
      ingest: async (providerId, snapshot) => {
        const settings = await settingsStore.read();
        const result = await captureStore.ingest(snapshot, {
          providerId,
          projectId: settings.activeProjectId,
        });
        if (result.inserted + result.updated > 0) {
          // Tells the side panel to refresh its list of captured conversations.
          void chrome.storage.session.set({ [CAPTURE_TICK_KEY]: Date.now() });
        }
        return result;
      },
      now: () => new Date().toISOString(),
    })
      .then(sendResponse)
      .catch((error) => {
        // Log the error type only: never message content.
        console.error('Continuity: message handling failed', error?.name ?? 'Error');
        sendResponse({ ok: false, error: 'internal' });
      });
    return true; // keep the channel open for the async response
  });
});