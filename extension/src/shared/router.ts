import type { IngestResult } from '../capture/ingest';
import type { Snapshot } from '../capture/snapshot';
import {
  ExtensionMessageSchema,
  type AdapterHealthRecord,
  type CaptureStatus,
  type TabStatus,
} from './messages';
import {
  getProvider,
  providerForUrl,
  type ProviderDefinition,
  type ProviderId,
} from './providers';

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
  saveAdapterHealth(tabId: number, record: AdapterHealthRecord): Promise<void>;
  ingest(providerId: ProviderId, snapshot: Snapshot): Promise<IngestResult>;
  now(): string;
}

export type RouterResponse =
  | {
      ok: true;
      status?: CaptureStatus;
      ingested?: { inserted: number; updated: number; unchanged: number };
    }
  | { ok: false; error: 'invalid_message' | 'forbidden' | 'capture_inactive' };

export async function routeMessage(
  raw: unknown,
  sender: SenderLike,
  deps: RouterDeps,
): Promise<RouterResponse> {
  // 1. Only our own extension may talk to us.
  if (sender.id !== deps.extensionId) return { ok: false, error: 'forbidden' };

  // 2. Messages are untrusted input: validate the shape and the size limits.
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

    case 'capture.health':
      await deps.saveAdapterHealth(tabId, {
        providerId: provider.id,
        ...message.health,
        seenAt: deps.now(),
      });
      return { ok: true };

    case 'capture.snapshot': {
      // A snapshot may only describe the conversation the sender's tab is actually showing.
      if (provider.conversationIdFromUrl(sender.url) !== message.snapshot.externalConversationId) {
        return { ok: false, error: 'forbidden' };
      }
      // Re-check on every snapshot: Off and Paused must stop storage immediately,
      // even if a page script has not noticed the change yet.
      if ((await deps.getCaptureStatus(provider)) !== 'on') {
        return { ok: false, error: 'capture_inactive' };
      }
      const result = await deps.ingest(provider.id, message.snapshot);
      return {
        ok: true,
        ingested: {
          inserted: result.inserted,
          updated: result.updated,
          unchanged: result.unchanged,
        },
      };
    }
  }
}