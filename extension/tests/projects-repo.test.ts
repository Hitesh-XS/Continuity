import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type ContinuityDb } from '../src/storage/db';
import {
  ProjectNotFoundError,
  ProjectValidationError,
  createProjectRepository,
} from '../src/storage/projects';

let db: ContinuityDb;
let dbName: string;
let tick: number;

function makeRepo(target: ContinuityDb = db) {
  // Strictly increasing clock so ordering assertions are deterministic.
  return createProjectRepository(target, {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(),
  });
}

beforeEach(() => {
  dbName = `continuity-test-${crypto.randomUUID()}`;
  db = createDb(dbName);
  tick = 0;
});

afterEach(async () => {
  db.close();
  await Dexie.delete(dbName);
});

describe('project repository', () => {
  it('creates a project with sensible defaults', async () => {
    const project = await makeRepo().create({ name: 'My project' });
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(project).toMatchObject({
      name: 'My project',
      description: '',
      currentGoal: '',
      status: 'active',
      syncMode: 'metadata_only',
      schemaVersion: 1,
    });
    expect(project.createdAt).toBe(project.updatedAt);
    expect(await db.projects.count()).toBe(1);
  });

  it('trims the name', async () => {
    const project = await makeRepo().create({ name: '  Padded  ' });
    expect(project.name).toBe('Padded');
  });

  it.each([
    ['blank name', { name: '' }],
    ['whitespace name', { name: '   ' }],
    ['too long name', { name: 'x'.repeat(201) }],
    ['too long description', { name: 'ok', description: 'x'.repeat(5001) }],
    ['bad sync mode', { name: 'ok', syncMode: 'everything' }],
    ['not an object', 'nope'],
  ])('rejects %s and stores nothing', async (_label: string, input: unknown) => {
    await expect(makeRepo().create(input)).rejects.toBeInstanceOf(ProjectValidationError);
    expect(await db.projects.count()).toBe(0);
  });

  it('lists newest first and hides archived projects by default', async () => {
    const repo = makeRepo();
    const a = await repo.create({ name: 'a' });
    const b = await repo.create({ name: 'b' });
    const c = await repo.create({ name: 'c' });
    await repo.update(a.id, { description: 'touched' }); // a becomes the newest
    await repo.update(b.id, { status: 'archived' });
    expect((await repo.list()).map((p) => p.id)).toEqual([a.id, c.id]);
  });

  it('can include archived projects', async () => {
    const repo = makeRepo();
    const a = await repo.create({ name: 'a' });
    const b = await repo.create({ name: 'b' });
    await repo.update(b.id, { status: 'archived' });
    const ids = (await repo.list({ includeArchived: true })).map((p) => p.id);
    expect(ids).toEqual([b.id, a.id]);
  });

  it('gets a project by id, or undefined', async () => {
    const repo = makeRepo();
    const project = await repo.create({ name: 'x' });
    expect((await repo.get(project.id))?.name).toBe('x');
    expect(await repo.get(crypto.randomUUID())).toBeUndefined();
  });

  it('updates only the provided fields and bumps updatedAt', async () => {
    const repo = makeRepo();
    const created = await repo.create({ name: 'Old', description: 'keep me' });
    const updated = await repo.update(created.id, { name: 'New' });
    expect(updated.name).toBe('New');
    expect(updated.description).toBe('keep me');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt > created.updatedAt).toBe(true);
  });

  it('ignores attempts to change id or createdAt', async () => {
    const repo = makeRepo();
    const created = await repo.create({ name: 'x' });
    const updated = await repo.update(created.id, {
      id: 'other',
      createdAt: '2000-01-01T00:00:00.000Z',
      name: 'Renamed',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.name).toBe('Renamed');
  });

  it('rejects a blank name on update and leaves the record intact', async () => {
    const repo = makeRepo();
    const created = await repo.create({ name: 'Keep' });
    await expect(repo.update(created.id, { name: '' })).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
    expect((await repo.get(created.id))?.name).toBe('Keep');
  });

  it('throws when updating an unknown project', async () => {
    await expect(makeRepo().update(crypto.randomUUID(), { name: 'x' })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('removes projects, and removing a missing one is a no-op', async () => {
    const repo = makeRepo();
    const project = await repo.create({ name: 'x' });
    await repo.remove(project.id);
    expect(await repo.get(project.id)).toBeUndefined();
    await expect(repo.remove(project.id)).resolves.toBeUndefined();
  });

  it('keeps data after the database is closed and reopened', async () => {
    const project = await makeRepo().create({ name: 'Persistent' });
    db.close();
    const reopened = createDb(dbName);
    try {
      const found = await createProjectRepository(reopened).get(project.id);
      expect(found?.name).toBe('Persistent');
    } finally {
      reopened.close();
    }
  });
});