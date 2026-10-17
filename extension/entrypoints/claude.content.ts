import { CaptureStatusSchema, type CaptureStatus } from '../src/shared/messages';
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

    const state: { captureStatus: CaptureStatus } = { captureStatus: 'off' };

    async function send(message: unknown): Promise<unknown> {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch {
        return undefined; // e.g. extension reloaded: this old script just goes quiet
      }
    }

    async function refreshCaptureStatus(): Promise<void> {
      const response = await send({ type: 'capture.getState', providerId: CLAUDE.id });
      const parsed = CaptureStatusSchema.safeParse(
        (response as { status?: unknown } | undefined)?.status,
      );
      state.captureStatus = parsed.success ? parsed.data : 'off';
      // Phase 5: start or stop reading messages here, based on state.captureStatus.
    }

    void send({ type: 'content.ready', providerId: CLAUDE.id, path: location.pathname });
    void refreshCaptureStatus();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SETTINGS_KEY in changes) void refreshCaptureStatus();
    });
  },
});