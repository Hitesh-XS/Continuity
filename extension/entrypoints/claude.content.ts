import { createPageCapture } from '../src/capture/page-capture';
import { handleInsertRequest } from '../src/handoff/insert-handler';
import { PanelToPageMessageSchema, isTrustedExtensionPage } from '../src/handoff/insert-message';
import { CaptureStatusSchema, type CaptureStatus } from '../src/shared/messages';
import { CLAUDE } from '../src/shared/providers';
import { SETTINGS_KEY } from '../src/shared/settings-store';

interface Instance {
  stop(): void;
}

export default defineContentScript({
  matches: [...CLAUDE.matches],
  registration: 'runtime', // registered only after the user enables Claude; not in the manifest
  runAt: 'document_idle',
  main() {
    const globals = window as unknown as { __continuityInstance?: Instance };
    // A newer copy REPLACES an older one (extension reloaded, or injected twice) instead of being
    // ignored, so a page never keeps a stale script that lacks the latest listeners.
    try {
      globals.__continuityInstance?.stop();
    } catch {
      // The old copy's extension context is gone: nothing to clean up.
    }

    async function send(message: unknown): Promise<unknown> {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch {
        return undefined; // e.g. extension reloaded: this old script just goes quiet
      }
    }

    const capture = createPageCapture({
      root: document,
      getUrl: () => location.href,
      getTitle: () => document.title,
      send,
      observe: (target, callback) => {
        const observer = new MutationObserver(callback);
        observer.observe(target, { childList: true, subtree: true, characterData: true });
        return () => observer.disconnect();
      },
      now: () => Date.now(),
      isAlive: () => Boolean(chrome.runtime?.id),
    });

    async function currentStatus(): Promise<CaptureStatus | undefined> {
      const response = await send({ type: 'capture.getState', providerId: CLAUDE.id });
      const parsed = CaptureStatusSchema.safeParse(
        (response as { status?: unknown } | undefined)?.status,
      );
      return parsed.success ? parsed.data : undefined;
    }

    let statusRetries = 0;
    async function refreshCaptureStatus(): Promise<void> {
      const status = await currentStatus();
      if (status !== undefined) {
        statusRetries = 0;
        capture.setStatus(status);
        return;
      }
      if (statusRetries < 3) {
        statusRetries += 1;
        setTimeout(() => void refreshCaptureStatus(), 3000);
      }
    }

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area === 'local' && SETTINGS_KEY in changes) void refreshCaptureStatus();
    };

    // "Insert the handoff package" requests from the side panel. Never sends anything.
    const onMessage = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): boolean => {
      const parsed = PanelToPageMessageSchema.safeParse(message);
      if (!parsed.success) return false; // not a message for this handler
      if (!isTrustedExtensionPage(sender, chrome.runtime.id)) {
        sendResponse({ ok: false, error: 'forbidden' });
        return false;
      }
      handleInsertRequest(
        { doc: document, getUrl: () => location.href, getStatus: currentStatus },
        parsed.data.text,
      )
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: 'insert_failed' }));
      return true; // the answer arrives asynchronously
    };

    // Listen FIRST, so there is a receiver as early as possible.
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.storage.onChanged.addListener(onStorageChanged);
    globals.__continuityInstance = {
      stop() {
        capture.stop();
        try {
          chrome.runtime.onMessage.removeListener(onMessage);
          chrome.storage.onChanged.removeListener(onStorageChanged);
        } catch {
          // The extension context may already be invalid.
        }
      },
    };

    void send({ type: 'content.ready', providerId: CLAUDE.id, path: location.pathname });
    capture.start();
    void refreshCaptureStatus();
  },
});