import { ExtensionMessageSchema, type CaptureStatus, type TabStatus } from './messages';
import { getProvider, providerForUrl, type ProviderDefinition } from './providers';

/** The parts of chrome.runtime.MessageSender that we rely on. */
export interface SenderLike {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

export interface RouterDeps {
  extensionId: string;
  getCaptureStatus(provider: ProviderDefinition): Promise<CaptureStatus>;
  saveTabStatus(tabId: number, status: TabStatus): Promise<void>;
  now(): string;
}

export type RouterResponse =
  | { ok: true; status?: CaptureStatus }
  | { ok: false; error: 'invalid_message' | 'forbidden' };

export async function routeMessage(
  raw: unknown,
  sender: SenderLike,
  deps: RouterDeps,
): Promise<RouterResponse> {
  // 1. Only our own extension may talk to us.
  if (sender.id !== deps.extensionId) return { ok: false, error: 'forbidden' };

  // 2. Messages are untrusted input: validate the shape.
  const parsed = ExtensionMessageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_message' };
  const message = parsed.data;

  // 3. A content script must be running in a real tab on the provider's exact origin.
  const provider = getProvider(message.providerId);
  const tabId = sender.tab?.id;
  if (!provider || tabId === undefined || providerForUrl(sender.url)?.id !== provider.id) {
    return { ok: false, error: 'forbidden' };
  }

  switch (message.type) {
    case 'content.ready':
      await deps.saveTabStatus(tabId, {
        providerId: provider.id,
        path: message.path,
        seenAt: deps.now(),
      });
      return { ok: true };
    case 'capture.getState':
      return { ok: true, status: await deps.getCaptureStatus(provider) };
  }
}