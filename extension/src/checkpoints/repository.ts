import Dexie from 'dexie';
import type { z } from 'zod';
import {
  CHECKPOINT_SCHEMA_VERSION,
  type CheckpointSourceRef,
  type ContinuityDb,
  type LocalCheckpoint,
} from '../storage/db';
import { CreateCheckpointInputSchema } from './schema';

export class CheckpointValidationError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Invalid checkpoint field(s): ${fields.join(', ')}`);
    this.name = 'CheckpointValidationError';
    this.fields = fields;
  }
}

export class CheckpointProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = 'CheckpointProjectNotFoundError';
  }
}

export class CheckpointNotFoundError extends Error {
  constructor(id: string) {
    super(`Checkpoint not found: ${id}`);
    this.name = 'CheckpointNotFoundError';
  }
}

function fieldNames(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join('.') || 'input');
}

export interface RepositoryOptions {
  now?: () => string;
  newId?: () => string;
}

export function createCheckpointRepository(db: ContinuityDb, options: RepositoryOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());

  const versionsOf = (projectId: string) =>
    db.checkpoints
      .where('[projectId+version]')
      .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey]);

  async function nextVersion(projectId: string): Promise<number> {
    const latest = await versionsOf(projectId).last();
    return (latest?.version ?? 0) + 1;
  }

  /** Builds source references from what is actually in the database. */
  async function buildSources(conversationIds: string[]): Promise<CheckpointSourceRef[]> {
    const sources: CheckpointSourceRef[] = [];
    for (const id of new Set(conversationIds)) {
      const conversation = await db.conversations.get(id);
      if (!conversation) throw new CheckpointValidationError(['conversationIds']);
      const last = await db.messages
        .where('[conversationId+ordinal]')
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .last();
      sources.push({
        conversationId: id,
        title: conversation.title,
        messageCount: conversation.messageCount,
        lastOrdinal: last?.ordinal ?? null,
      });
    }
    return sources;
  }

  async function create(projectId: string, raw: unknown): Promise<LocalCheckpoint> {
    const parsed = CreateCheckpointInputSchema.safeParse(raw);
    if (!parsed.success) throw new CheckpointValidationError(fieldNames(parsed.error));
    const input = parsed.data;

    return db.transaction(
      'rw',
      [db.checkpoints, db.projects, db.conversations, db.messages],
      async () => {
        if (!(await db.projects.get(projectId))) throw new CheckpointProjectNotFoundError(projectId);
        const checkpoint: LocalCheckpoint = {
          id: newId(),
          projectId,
          version: await nextVersion(projectId),
          reason: 'manual',
          schemaVersion: CHECKPOINT_SCHEMA_VERSION,
          objective: input.objective,
          state: {
            schemaVersion: 1,
            decisions: input.decisions,
            completed: input.completed,
            blockers: input.blockers,
            nextAction: input.nextAction,
            notes: input.notes,
            sources: await buildSources(input.conversationIds),
          },
          userEdited: true,
          restoredFromId: null,
          restoredFromVersion: null,
          createdAt: now(),
        };
        await db.checkpoints.add(checkpoint);
        return checkpoint;
      },
    );
  }

  /** Creates a NEW version with the same content. The original is never touched. */
  async function restore(checkpointId: string): Promise<LocalCheckpoint> {
    return db.transaction('rw', db.checkpoints, async () => {
      const original = await db.checkpoints.get(checkpointId);
      if (!original) throw new CheckpointNotFoundError(checkpointId);
      const checkpoint: LocalCheckpoint = {
        ...original,
        id: newId(),
        version: await nextVersion(original.projectId),
        reason: 'recovery',
        state: structuredClone(original.state),
        userEdited: false,
        restoredFromId: original.id,
        restoredFromVersion: original.version,
        createdAt: now(),
      };
      await db.checkpoints.add(checkpoint);
      return checkpoint;
    });
  }

  /** Newest version first. */
  async function list(projectId: string): Promise<LocalCheckpoint[]> {
    return versionsOf(projectId).reverse().toArray();
  }

  async function latest(projectId: string): Promise<LocalCheckpoint | undefined> {
    return versionsOf(projectId).last();
  }

  async function get(id: string): Promise<LocalCheckpoint | undefined> {
    return db.checkpoints.get(id);
  }

  /** Deleting is the user's right. Other versions keep their numbers. */
  async function remove(id: string): Promise<void> {
    await db.checkpoints.delete(id);
  }

  return { create, restore, list, latest, get, remove };
}

export type CheckpointRepository = ReturnType<typeof createCheckpointRepository>;