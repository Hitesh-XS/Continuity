import Dexie, { type EntityTable } from 'dexie';
import type { MessageRole } from '../capture/snapshot';
import type { ProviderId } from '../shared/providers';

export const DB_NAME = 'continuity';
export const PROJECT_SCHEMA_VERSION = 1;
export const CONVERSATION_SCHEMA_VERSION = 1;
export const MESSAGE_SCHEMA_VERSION = 1;

// Same values as the Django Project model, so projects can sync later.
export const PROJECT_STATUSES = ['active', 'paused', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const SYNC_MODES = ['metadata_only', 'selected_content', 'full_transcript_opt_in'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export interface LocalProject {
  id: string; // client-generated UUID; the server accepts it as the project's ID
  name: string;
  description: string;
  currentGoal: string;
  status: ProjectStatus;
  syncMode: SyncMode;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  schemaVersion: number;
}

export interface LocalConversation {
  id: string; // `${providerId}:${externalId}`
  providerId: ProviderId;
  externalId: string; // the provider's own conversation ID (taken from the URL)
  title: string;
  projectId: string | null; // the active project when capture first saw this conversation
  messageCount: number;
  createdAt: string;
  updatedAt: string; // last time message CONTENT changed
  lastCapturedAt: string; // last time a snapshot was received
  schemaVersion: number;
}

export interface LocalMessage {
  id: string; // `${conversationId}#${key}`
  conversationId: string;
  key: string; // adapter-provided stable key, or "o<position>"
  ordinal: number; // position in the conversation at last capture
  role: MessageRole;
  text: string;
  contentHash: string; // SHA-256 of role + "\n" + text
  revision: number; // 1 on first capture, +1 every time the content changes
  firstSeenAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export type ContinuityDb = Dexie & {
  projects: EntityTable<LocalProject, 'id'>;
  conversations: EntityTable<LocalConversation, 'id'>;
  messages: EntityTable<LocalMessage, 'id'>;
};

export function createDb(name: string = DB_NAME): ContinuityDb {
  const db = new Dexie(name) as ContinuityDb;
  // Never edit an existing version. Add a new db.version(n) for every schema change.
  db.version(1).stores({ projects: 'id, status, updatedAt' });
  db.version(2).stores({
    conversations: 'id, providerId, projectId, updatedAt',
    messages: 'id, conversationId, [conversationId+ordinal]',
  });
  return db;
}