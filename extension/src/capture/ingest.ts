import type { ProviderId } from '../shared/providers';
import {
  CONVERSATION_SCHEMA_VERSION,
  MESSAGE_SCHEMA_VERSION,
  type ContinuityDb,
  type LocalConversation,
  type LocalMessage,
} from '../storage/db';
import { hashText, type Snapshot } from './snapshot';

export interface IngestContext {
  providerId: ProviderId;
  projectId: string | null;
}

export interface IngestResult {
  conversationId: string;
  inserted: number;
  updated: number;
  unchanged: number;
}

export const conversationIdFor = (providerId: ProviderId, externalId: string): string =>
  `${providerId}:${externalId}`;

export const messageIdFor = (conversationId: string, key: string): string =>
  `${conversationId}#${key}`;

export function createCaptureStore(db: ContinuityDb, options: { now?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString());

  async function ingest(snapshot: Snapshot, context: IngestContext): Promise<IngestResult> {
    const conversationId = conversationIdFor(context.providerId, snapshot.externalConversationId);

    // Hash BEFORE the transaction: Dexie transactions must not await non-Dexie promises
    // (like crypto.subtle), or they commit early and later writes fail.
    const prepared = await Promise.all(
      snapshot.messages.map(async (message, ordinal) => {
        const key = message.key ?? `o${ordinal}`;
        return {
          id: messageIdFor(conversationId, key),
          key,
          ordinal,
          role: message.role,
          text: message.text,
          contentHash: await hashText(`${message.role}\n${message.text}`),
        };
      }),
    );

    const timestamp = now();

    return db.transaction('rw', db.conversations, db.messages, async () => {
      const existingConversation = await db.conversations.get(conversationId);
      const existingMessages = await db.messages.bulkGet(prepared.map((item) => item.id));

      const toWrite: LocalMessage[] = [];
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;

      prepared.forEach((item, index) => {
        const existing = existingMessages[index];
        if (!existing) {
          inserted += 1;
          toWrite.push({
            id: item.id,
            conversationId,
            key: item.key,
            ordinal: item.ordinal,
            role: item.role,
            text: item.text,
            contentHash: item.contentHash,
            revision: 1,
            firstSeenAt: timestamp,
            updatedAt: timestamp,
            schemaVersion: MESSAGE_SCHEMA_VERSION,
          });
        } else if (existing.contentHash !== item.contentHash) {
          updated += 1;
          toWrite.push({
            ...existing,
            ordinal: item.ordinal,
            role: item.role,
            text: item.text,
            contentHash: item.contentHash,
            revision: existing.revision + 1,
            updatedAt: timestamp,
          });
        } else {
          unchanged += 1;
          // Same content, but the message may have moved: keep its position current.
          if (existing.ordinal !== item.ordinal) toWrite.push({ ...existing, ordinal: item.ordinal });
        }
      });

      if (toWrite.length > 0) await db.messages.bulkPut(toWrite);

      // Messages absent from this snapshot are deliberately kept (see docs: limitations).
      const messageCount = await db.messages.where('conversationId').equals(conversationId).count();
      const contentChanged = inserted + updated > 0;
      const title = snapshot.title?.trim() ?? '';

      const conversation: LocalConversation = existingConversation
        ? {
            ...existingConversation,
            title: title || existingConversation.title,
            messageCount,
            lastCapturedAt: timestamp,
            updatedAt: contentChanged ? timestamp : existingConversation.updatedAt,
          }
        : {
            id: conversationId,
            providerId: context.providerId,
            externalId: snapshot.externalConversationId,
            title,
            projectId: context.projectId,
            messageCount,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastCapturedAt: timestamp,
            schemaVersion: CONVERSATION_SCHEMA_VERSION,
          };
      await db.conversations.put(conversation);

      return { conversationId, inserted, updated, unchanged };
    });
  }

  return { ingest };
}

export type CaptureStore = ReturnType<typeof createCaptureStore>;