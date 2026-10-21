import Dexie, { type EntityTable } from 'dexie';
import type { MessageRole } from '../capture/snapshot';
import type { ProviderId } from '../shared/providers';

export const DB_NAME = 'continuity';
export const PROJECT_SCHEMA_VERSION = 1;
export const CONVERSATION_SCHEMA_VERSION = 1;
export const MESSAGE_SCHEMA_VERSION = 1;
export const CHECKPOINT_SCHEMA_VERSION = 1;

// Same values as the Django Project model, so projects can sync.
export const PROJECT_STATUSES = ['active', 'paused', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const SYNC_MODES = ['metadata_only', 'selected_content', 'full_transcript_opt_in'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

// Same values as the Django Checkpoint model.
export const CHECKPOINT_REASONS = [
  'manual',
  'estimated_pressure',
  'session_end',
  'provider_limit_ui',
  'recovery',
] as const;
export type CheckpointReason = (typeof CHECKPOINT_REASONS)[number];

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

/** A reference to a captured conversation. It never contains conversation text. */
export interface CheckpointSourceRef {
  conversationId: string;
  title: string;
  messageCount: number;
  /** Zero-based position of the last captured message, or null when none were captured. */
  lastOrdinal: number | null;
}

/** Becomes the server's `state_snapshot` when sync is on. */
export interface CheckpointState {
  schemaVersion: 1;
  decisions: string[];
  completed: string[];
  blockers: string[];
  nextAction: string;
  notes: string;
  sources: CheckpointSourceRef[];
}

/** Immutable: the repository offers no way to change a saved checkpoint. */
export interface LocalCheckpoint {
  id: string; // client-generated UUID; the server accepts it as the checkpoint's ID
  projectId: string;
  version: number; // per project, local to this browser
  reason: CheckpointReason;
  schemaVersion: number;
  objective: string;
  state: CheckpointState;
  userEdited: boolean;
  restoredFromId: string | null;
  restoredFromVersion: number | null;
  createdAt: string;
}

// ---- Sync (Phase 6b) --------------------------------------------------------

export type SyncResultKind = 'ok' | 'partial' | 'offline' | 'signed_out' | 'error';

/** The signed-in session. Lives in the extension's own IndexedDB, never visible to web pages. */
export interface AuthRecord {
  key: 'session';
  userId: string;
  email: string;
  accessToken: string;
  accessExpiresAt: number; // epoch milliseconds
  refreshToken: string;
}

export interface SyncConfigRecord {
  key: 'config';
  enabled: boolean;
  consentAt: string | null;
  /** The server account that `syncItems` refer to. */
  accountId: string | null;
  lastRunAt: string | null;
  lastResult: SyncResultKind | null;
  lastError: string | null;
}

/** What we know the server has. Never contains content, only identifiers and a fingerprint. */
export interface SyncItemRecord {
  id: string; // "project:<uuid>" or "checkpoint:<uuid>"
  kind: 'project' | 'checkpoint';
  entityId: string;
  parentId: string | null; // a checkpoint's project
  status: 'synced' | 'failed';
  hash: string;
  serverVersion: number | null;
  error: string | null;
  updatedAt: string;
}

export type ContinuityDb = Dexie & {
  projects: EntityTable<LocalProject, 'id'>;
  conversations: EntityTable<LocalConversation, 'id'>;
  messages: EntityTable<LocalMessage, 'id'>;
  checkpoints: EntityTable<LocalCheckpoint, 'id'>;
  auth: EntityTable<AuthRecord, 'key'>;
  syncConfig: EntityTable<SyncConfigRecord, 'key'>;
  syncItems: EntityTable<SyncItemRecord, 'id'>;
};

export function createDb(name: string = DB_NAME): ContinuityDb {
  const db = new Dexie(name) as ContinuityDb;
  // Never edit an existing version. Add a new db.version(n) for every schema change.
  db.version(1).stores({ projects: 'id, status, updatedAt' });
  db.version(2).stores({
    conversations: 'id, providerId, projectId, updatedAt',
    messages: 'id, conversationId, [conversationId+ordinal]',
  });
  db.version(3).stores({
    // "&" makes [projectId+version] unique: the database itself refuses duplicate versions.
    checkpoints: 'id, projectId, &[projectId+version]',
  });
  db.version(4).stores({
    auth: 'key',
    syncConfig: 'key',
    syncItems: 'id, kind, status, parentId',
  });
  return db;
}