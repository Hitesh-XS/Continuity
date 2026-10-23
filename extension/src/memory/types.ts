export const MEMORY_SCHEMA_VERSION = 1;

export const MEMORY_KINDS = ['fact', 'preference', 'decision', 'hypothesis', 'task', 'blocker'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = [
  'proposed',
  'confirmed',
  'open',
  'done',
  'resolved',
  'disputed',
  'superseded',
  'rejected',
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** 'extracted' is for the future AI step: such items can never start out verified. */
export const MEMORY_ORIGINS = ['user', 'extracted'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

/** A reference to a captured message. It never contains message text. */
export interface EvidenceRef {
  conversationId: string;
  messageId: string;
  /** The message's content hash when it was linked, to detect later changes. */
  contentHash: string;
  linkedAt: string;
}

export interface LocalMemoryItem {
  id: string;
  projectId: string;
  kind: MemoryKind;
  text: string;
  /** Optional short label ("database", "auth"). Items sharing kind and topic are checked for conflicts. */
  topic: string;
  status: MemoryStatus;
  origin: MemoryOrigin;
  evidence: EvidenceRef[];
  conflictsWith: string[];
  supersededById: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export const MEMORY_HISTORY_ACTIONS = [
  'created',
  'edited',
  'status_changed',
  'superseded',
  'conflict_flagged',
  'conflict_resolved',
  'conflict_cleared',
  'evidence_added',
  'evidence_removed',
] as const;
export type MemoryHistoryAction = (typeof MEMORY_HISTORY_ACTIONS)[number];

export interface MemoryHistoryEntry {
  id: string;
  itemId: string;
  projectId: string;
  /** Orders entries that share a timestamp. */
  n: number;
  at: string;
  action: MemoryHistoryAction;
  fromStatus: MemoryStatus | null;
  toStatus: MemoryStatus | null;
  /** The text before an edit. */
  fromText: string | null;
}