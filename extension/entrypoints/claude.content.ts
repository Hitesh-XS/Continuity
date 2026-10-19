import { createPageCapture } from '../src/capture/page-capture';
import { CaptureStatusSchema } from '../src/shared/messages';
import { CLAUDE } from '../src/shared/providers';
import { SETTINGS_KEY } from '../src/shared/settings-store';

export default defineContentScript({
  matches: [...CLAUDE.matches],
  registration: 'runtime', // registered only after the user enables Claude; not in the manifest
  runAt: 'document_idle',
  main() {
    // Injecting twice (enable, remove, enable) must not create two copies.
    const globals = window as unknown as Record<string, unknown>;
    if (globals.__continuityContentLoaded) return;
    globals.__continuityContentLoaded = true;

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

    let statusRetries = 0;
    async function refreshCaptureStatus(): Promise<void> {
      const response = await send({ type: 'capture.getState', providerId: CLAUDE.id });
      const parsed = CaptureStatusSchema.safeParse(
        (response as { status?: unknown } | undefined)?.status,
      );
      if (parsed.success) {
        statusRetries = 0;
        capture.setStatus(parsed.data);
        return;
      }
      if (statusRetries < 3) {
        statusRetries += 1;
        setTimeout(() => void refreshCaptureStatus(), 3000);
      }
    }

    void send({ type: 'content.ready', providerId: CLAUDE.id, path: location.pathname });
    capture.start();
    void refreshCaptureStatus();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SETTINGS_KEY in changes) void refreshCaptureStatus();
    });
  },
});