import Dexie, { type EntityTable } from 'dexie';

export const DB_NAME = 'continuity';
export const PROJECT_SCHEMA_VERSION = 1;

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

export type ContinuityDb = Dexie & { projects: EntityTable<LocalProject, 'id'> };

export function createDb(name: string = DB_NAME): ContinuityDb {
  const db = new Dexie(name) as ContinuityDb;
  // Later phases add tables with db.version(2).stores({...}); never edit version 1.
  db.version(1).stores({ projects: 'id, status, updatedAt' });
  return db;
}