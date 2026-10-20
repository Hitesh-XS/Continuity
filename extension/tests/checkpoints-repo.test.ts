import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCaptureStore } from '../src/capture/ingest';
import {
  CheckpointNotFoundError,
  CheckpointProjectNotFoundError,
  CheckpointValidationError,
  createCheckpointRepository,
} from '../src/checkpoints/repository';
import type { ContinuityDb } from '../src/storage/db';
import { createProjectRepository } from '../src/storage/projects';
import { openTestDb, tickingClock } from './helpers';

const valid = { objective: 'Ship it', nextAction: 'Write tests' };

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let repo: ReturnType<typeof createCheckpointRepository>;
let projects: ReturnType<typeof createProjectRepository>;
let capture: ReturnType<typeof createCaptureStore>;

beforeEach(() => {
  ({ db, cleanup } = openTestDb());
  const clock = tickingClock();
  repo = createCheckpointRepository(db, { now: clock });
  projects = createProjectRepository(db, { now: clock });
  capture = createCaptureStore(db, { now: clock });
});

afterEach(async () => {
  await cleanup();
});

describe('checkpoint repository', () => {
  it('creates version 1 with normalised content', async () => {
    const project = await projects.create({ name: 'P' });
    const checkpoint = await repo.create(project.id, {
      ...valid,
      decisions: ['A', 'B'],
      notes: '  hi  ',
    });
    expect(checkpoint).toMatchObject({
      projectId: project.id,
      version: 1,
      reason: 'manual',
      schemaVersion: 1,
      objective: 'Ship it',
      userEdited: true,
      restoredFromId: null,
      restoredFromVersion: null,
    });
    expect(checkpoint.state).toEqual({
      schemaVersion: 1,
      decisions: ['A', 'B'],
      completed: [],
      blockers: [],
      nextAction: 'Write tests',
      notes: 'hi',
      sources: [],
    });
    expect(await db.checkpoints.count()).toBe(1);
  });

  it('numbers versions per project', async () => {
    const a = await projects.create({ name: 'A' });
    const b = await projects.create({ name: 'B' });
    expect((await repo.create(a.id, valid)).version).toBe(1);
    expect((await repo.create(a.id, valid)).version).toBe(2);
    expect((await repo.create(b.id, valid)).version).toBe(1);
  });

  it('rejects invalid input and stores nothing', async () => {
    const project = await projects.create({ name: 'P' });
    const error = await repo.create(project.id, { objective: '', nextAction: '' }).catch((e) => e);
    expect(error).toBeInstanceOf(CheckpointValidationError);
    expect((error as CheckpointValidationError).fields).toEqual(
      expect.arrayContaining(['objective', 'nextAction']),
    );
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('rejects an unknown project', async () => {
    await expect(repo.create(crypto.randomUUID(), valid)).rejects.toBeInstanceOf(
      CheckpointProjectNotFoundError,
    );
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('computes source references from the database, once per conversation', async () => {
    const project = await projects.create({ name: 'P' });
    await capture.ingest(
      {
        externalConversationId: 'abc',
        title: 'Auth chat',
        messages: [
          { index: 0, role: 'user', text: 'one' },
          { index: 1, role: 'assistant', text: 'two' },
          { index: 2, role: 'user', text: 'three' },
        ],
      },
      { providerId: 'claude', projectId: project.id },
    );
    const checkpoint = await repo.create(project.id, {
      ...valid,
      conversationIds: ['claude:abc', 'claude:abc'],
    });
    expect(checkpoint.state.sources).toEqual([
      { conversationId: 'claude:abc', title: 'Auth chat', messageCount: 3, lastOrdinal: 2 },
    ]);
  });

  it('rejects a source conversation that does not exist and stores nothing', async () => {
    const project = await projects.create({ name: 'P' });
    const error = await repo
      .create(project.id, { ...valid, conversationIds: ['claude:missing'] })
      .catch((e) => e);
    expect(error).toBeInstanceOf(CheckpointValidationError);
    expect((error as CheckpointValidationError).fields).toEqual(['conversationIds']);
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('never copies conversation text into a checkpoint', async () => {
    const project = await projects.create({ name: 'P' });
    await capture.ingest(
      {
        externalConversationId: 'abc',
        messages: [{ index: 0, role: 'user', text: 'SECRET-TEXT-12345' }],
      },
      { providerId: 'claude', projectId: project.id },
    );
    await repo.create(project.id, { ...valid, conversationIds: ['claude:abc'] });
    expect(JSON.stringify(await db.checkpoints.toArray())).not.toContain('SECRET-TEXT-12345');
  });

  it('lists a project’s checkpoints newest first', async () => {
    const a = await projects.create({ name: 'A' });
    const b = await projects.create({ name: 'B' });
    await repo.create(a.id, valid);
    await repo.create(b.id, valid);
    await repo.create(a.id, valid);
    await repo.create(a.id, valid);
    expect((await repo.list(a.id)).map((c) => c.version)).toEqual([3, 2, 1]);
    expect((await repo.list(b.id)).map((c) => c.version)).toEqual([1]);
  });

  it('returns the latest checkpoint, or undefined when there is none', async () => {
    const project = await projects.create({ name: 'P' });
    expect(await repo.latest(project.id)).toBeUndefined();
    await repo.create(project.id, valid);
    await repo.create(project.id, { ...valid, objective: 'Second' });
    expect((await repo.latest(project.id))?.objective).toBe('Second');
  });

  it('gets a checkpoint by id, or undefined', async () => {
    const project = await projects.create({ name: 'P' });
    const checkpoint = await repo.create(project.id, valid);
    expect((await repo.get(checkpoint.id))?.version).toBe(1);
    expect(await repo.get(crypto.randomUUID())).toBeUndefined();
  });

  it('restores as a NEW recovery version with the same content', async () => {
    const project = await projects.create({ name: 'P' });
    const first = await repo.create(project.id, { ...valid, objective: 'First', decisions: ['A'] });
    await repo.create(project.id, { ...valid, objective: 'Second' });
    const restored = await repo.restore(first.id);
    expect(restored).toMatchObject({
      version: 3,
      reason: 'recovery',
      userEdited: false,
      objective: 'First',
      restoredFromId: first.id,
      restoredFromVersion: 1,
    });
    expect(restored.id).not.toBe(first.id);
    expect(restored.state).toEqual(first.state);
  });

  it('rejects restoring an unknown checkpoint', async () => {
    await expect(repo.restore(crypto.randomUUID())).rejects.toBeInstanceOf(CheckpointNotFoundError);
  });

  it('leaves the original untouched when restoring', async () => {
    const project = await projects.create({ name: 'P' });
    const first = await repo.create(project.id, valid);
    await repo.restore(first.id);
    expect(await repo.get(first.id)).toEqual(first);
    expect(await db.checkpoints.count()).toBe(2);
  });

  it('removes only the chosen checkpoint and keeps the others’ numbers', async () => {
    const project = await projects.create({ name: 'P' });
    await repo.create(project.id, valid);
    const second = await repo.create(project.id, valid);
    await repo.create(project.id, valid);
    await repo.remove(second.id);
    expect((await repo.list(project.id)).map((c) => c.version)).toEqual([3, 1]);
  });

  it('reuses a number after the newest checkpoint is deleted (documented behaviour)', async () => {
    const project = await projects.create({ name: 'P' });
    await repo.create(project.id, valid);
    const second = await repo.create(project.id, valid);
    await repo.remove(second.id);
    expect((await repo.create(project.id, valid)).version).toBe(2);
  });

  it('treats removing a missing checkpoint as a no-op', async () => {
    await expect(repo.remove(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('deletes a project’s checkpoints when the project is deleted', async () => {
    const project = await projects.create({ name: 'P' });
    await repo.create(project.id, valid);
    await repo.create(project.id, valid);
    await projects.remove(project.id);
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('leaves other projects’ checkpoints alone when one project is deleted', async () => {
    const a = await projects.create({ name: 'A' });
    const b = await projects.create({ name: 'B' });
    await repo.create(a.id, valid);
    await repo.create(b.id, valid);
    await projects.remove(a.id);
    expect((await repo.list(b.id)).length).toBe(1);
  });
});