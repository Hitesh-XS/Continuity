import Dexie from 'dexie';
import type { ContinuityDb, LocalConversation, LocalMessage } from '../storage/db';

export function createConversationRepository(db: ContinuityDb) {
  /** Newest content change first. Pass projectId (or null for unassigned) to filter. */
  async function list(options: { projectId?: string | null } = {}): Promise<LocalConversation[]> {
    const all = await db.conversations.orderBy('updatedAt').reverse().toArray();
    if (options.projectId === undefined) return all;
    return all.filter((conversation) => conversation.projectId === options.projectId);
  }

  async function get(id: string): Promise<LocalConversation | undefined> {
    return db.conversations.get(id);
  }

  async function getMessages(conversationId: string): Promise<LocalMessage[]> {
    return db.messages
      .where('[conversationId+ordinal]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .toArray();
  }

  /** Deletes one conversation and all of its messages. */
  async function remove(id: string): Promise<void> {
    await db.transaction('rw', db.conversations, db.messages, async () => {
      await db.messages.where('conversationId').equals(id).delete();
      await db.conversations.delete(id);
    });
  }

  /** Deletes every captured conversation and message. Projects are untouched. */
  async function removeAll(): Promise<void> {
    await db.transaction('rw', db.conversations, db.messages, async () => {
      await db.messages.clear();
      await db.conversations.clear();
    });
  }

  return { list, get, getMessages, remove, removeAll };
}

export type ConversationRepository = ReturnType<typeof createConversationRepository>;