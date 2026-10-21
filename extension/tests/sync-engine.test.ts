import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCheckpointRepository } from '../src/checkpoints/repository';
import type { ContinuityDb } from '../src/storage/db';
import { createProjectRepository } from '../src/storage/projects';
import { checkpointItemId, createSyncEngine, planSize, projectItemId } from '../src/sync/engine';
import { ApiError, AuthExpiredError, NetworkError } from '../src/sync/errors';
import { createSyncStore, type SyncStore } from '../src/sync/store';
import { openTestDb, tickingClock } from './helpers';
import { fakeApi, type Handlers } from './sync-helpers';

const valid = { objective: 'Ship it', nextAction: 'Write tests' };

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let store: SyncStore;
let projects: ReturnType<typeof createProjectRepository>;
let checkpoints: ReturnType<typeof createCheckpointRepository>;

beforeEach(async () => {
  ({ db, cleanup } = openTestDb());
  const clock = tickingClock();
  store = createSyncStore(db);
  projects = createProjectRepository(db, { now: clock });
  checkpoints = createCheckpointRepository(db, { now: clock });
  await store.setAuth({
    key: 'session',
    userId: 'u1',
    email: 'a@example.com',
    accessToken: 'a',
    accessExpiresAt: 9e15,
    refreshToken: 'r',
  });
  await store.updateConfig({ enabled: true, consentAt: '2026-01-01T00:00:00.000Z', accountId: 'u1' });
});

afterEach(async () => {
  await cleanup();
});

function setup(handlers: Handlers = {}) {
  const fake = fakeApi(handlers);
  const engine = createSyncEngine({ db, store, api: fake.api, now: tickingClock() });
  return { ...fake, engine };
}

const selectedProject = (name = 'P') => projects.create({ name, syncMode: 'selected_content' });

describe('sync engine: gates', () => {
  it('does nothing while sync is off', async () => {
    await store.updateConfig({ enabled: false });
    const t = setup();
    expect((await t.engine.run()).kind).toBe('disabled');
    expect(t.calls).toEqual([]);
  });

  it('reports signed_out when there is no session', async () => {
    await store.clearAuth();
    const t = setup();
    expect((await t.engine.run()).kind).toBe('signed_out');
    expect(t.calls).toEqual([]);
  });
});

describe('sync engine: uploads', () => {
  it('uploads a metadata-only project but not its checkpoints', async () => {
    const project = await projects.create({ name: 'P' });
    await checkpoints.create(project.id, valid);
    const t = setup();
    expect(await t.engine.run()).toMatchObject({ kind: 'ok', synced: 1, failed: 0 });
    expect(t.calls).toEqual([`createProject:${project.id}`]);
  });

  it('uploads checkpoints for a selected_content project', async () => {
    const project = await selectedProject();
    const checkpoint = await checkpoints.create(project.id, { ...valid, decisions: ['Use JWT'] });
    const t = setup();
    await t.engine.run();
    expect(t.calls).toEqual([`createProject:${project.id}`, `createCheckpoint:${checkpoint.id}`]);
    expect(t.checkpointBodies[0]).toMatchObject({
      id: checkpoint.id,
      reason: 'manual',
      schema_version: 1,
      objective: 'Ship it',
      user_edited: true,
    });
    expect(t.checkpointBodies[0]?.state_snapshot.decisions).toEqual(['Use JWT']);
    expect(await store.listItems()).toHaveLength(2);
  });

  it('records the version the server assigned', async () => {
    const project = await selectedProject();
    const checkpoint = await checkpoints.create(project.id, valid);
    const t = setup({ createCheckpoint: () => ({ status: 201, data: { version: 7 } }) });
    await t.engine.run();
    expect((await store.getItem(checkpointItemId(checkpoint.id)))?.serverVersion).toBe(7);
  });

  it('makes no calls on a second run', async () => {
    const project = await selectedProject();
    await checkpoints.create(project.id, valid);
    const t = setup();
    await t.engine.run();
    const before = t.calls.length;
    expect(await t.engine.run()).toMatchObject({ kind: 'ok', synced: 0 });
    expect(t.calls.length).toBe(before);
  });

  it('patches a project after a local edit', async () => {
    const project = await projects.create({ name: 'P' });
    const t = setup();
    await t.engine.run();
    await projects.update(project.id, { name: 'Renamed' });
    await t.engine.run();
    expect(t.calls[t.calls.length - 1]).toBe(`patchProject:${project.id}`);
  });

  it('uploads existing checkpoints when a project switches to selected_content', async () => {
    const project = await projects.create({ name: 'P' });
    const checkpoint = await checkpoints.create(project.id, valid);
    const t = setup();
    await t.engine.run();
    expect(t.calls).toEqual([`createProject:${project.id}`]);
    await projects.update(project.id, { syncMode: 'selected_content' });
    await t.engine.run();
    expect(t.calls.slice(1)).toEqual([
      `patchProject:${project.id}`,
      `createCheckpoint:${checkpoint.id}`,
    ]);
  });

  it('follows a create that found an existing project with a patch', async () => {
    const project = await projects.create({ name: 'P' });
    const t = setup({ createProject: () => ({ status: 200, data: {} }) });
    await t.engine.run();
    expect(t.calls).toEqual([`createProject:${project.id}`, `patchProject:${project.id}`]);
  });

  it('recreates a project the server no longer has', async () => {
    const project = await projects.create({ name: 'P' });
    const t = setup({
      patchProject: () => {
        throw new ApiError(404, 'not_found', 'gone');
      },
    });
    await t.engine.run();
    await projects.update(project.id, { name: 'Renamed' });
    await t.engine.run();
    expect(t.calls.slice(1)).toEqual([`patchProject:${project.id}`, `createProject:${project.id}`]);
    expect((await store.getItem(projectItemId(project.id)))?.status).toBe('synced');
  });
});

describe('sync engine: deletions', () => {
  it('deletes the server copy of a checkpoint removed locally', async () => {
    const project = await selectedProject();
    const checkpoint = await checkpoints.create(project.id, valid);
    const t = setup();
    await t.engine.run();
    await checkpoints.remove(checkpoint.id);
    await t.engine.run();
    expect(t.calls).toContain(`deleteCheckpoint:${checkpoint.id}`);
    expect(await store.getItem(checkpointItemId(checkpoint.id))).toBeUndefined();
  });

  it('never uploads a checkpoint deleted before it synced', async () => {
    const project = await selectedProject();
    const checkpoint = await checkpoints.create(project.id, valid);
    await checkpoints.remove(checkpoint.id);
    const t = setup();
    await t.engine.run();
    expect(t.calls).toEqual([`createProject:${project.id}`]);
  });

  it('deletes a project on the server without separate checkpoint deletes', async () => {
    const project = await selectedProject();
    await checkpoints.create(project.id, valid);
    await checkpoints.create(project.id, valid);
    const t = setup();
    await t.engine.run();
    const before = t.calls.length;
    await projects.remove(project.id);
    await t.engine.run();
    expect(t.calls.slice(before)).toEqual([`deleteProject:${project.id}`]);
    expect(await store.listItems()).toEqual([]);
  });
});

describe('sync engine: failures', () => {
  it('stops on a network error and finishes on the next run', async () => {
    const project = await projects.create({ name: 'P' });
    let first = true;
    const t = setup({
      createProject: () => {
        if (first) {
          first = false;
          throw new NetworkError();
        }
        return { status: 201, data: {} };
      },
    });
    expect((await t.engine.run()).kind).toBe('offline');
    expect((await store.getConfig()).lastResult).toBe('offline');
    expect(await store.getItem(projectItemId(project.id))).toBeUndefined();
    expect(await t.engine.run()).toMatchObject({ kind: 'ok', synced: 1 });
  });

  it('records a permanent failure, carries on, and retries only on request', async () => {
    const a = await projects.create({ name: 'A' });
    const b = await projects.create({ name: 'B' });
    let block = true;
    const t = setup({
      createProject: (body) => {
        if (block && body.id === a.id) throw new ApiError(409, 'id_conflict', 'taken');
        return { status: 201, data: {} };
      },
    });
    expect(await t.engine.run()).toMatchObject({ kind: 'partial', synced: 1, failed: 1 });
    expect(await store.getItem(projectItemId(a.id))).toMatchObject({
      status: 'failed',
      error: '409 id_conflict',
    });
    expect(await store.getItem(projectItemId(b.id))).toMatchObject({ status: 'synced' });

    const before = t.calls.length;
    expect((await t.engine.run()).kind).toBe('partial');
    expect(t.calls.length).toBe(before);

    block = false;
    await t.engine.retryFailed();
    expect(await t.engine.run()).toMatchObject({ kind: 'ok', synced: 1, failed: 0 });
    expect(await store.getItem(projectItemId(a.id))).toMatchObject({ status: 'synced' });
  });

  it('waits to upload checkpoints until their project is on the server', async () => {
    const project = await selectedProject();
    await checkpoints.create(project.id, valid);
    const t = setup({
      createProject: () => {
        throw new ApiError(400, 'validation_error', 'bad');
      },
    });
    expect(await t.engine.run()).toMatchObject({ kind: 'partial', failed: 1, waiting: 1 });
    expect(t.calls).toEqual([`createProject:${project.id}`]);
  });

  it('forgets a project the server lost when a checkpoint upload gets a 404', async () => {
    const project = await selectedProject();
    await checkpoints.create(project.id, valid);
    let first = true;
    const t = setup({
      createCheckpoint: () => {
        if (first) {
          first = false;
          throw new ApiError(404, 'not_found', 'gone');
        }
        return { status: 201, data: { version: 1 } };
      },
    });
    expect(await t.engine.run()).toMatchObject({ kind: 'partial', waiting: 1 });
    expect(await store.getItem(projectItemId(project.id))).toBeUndefined();
    expect((await t.engine.run()).kind).toBe('ok');
    expect(t.calls.filter((call) => call.startsWith('createProject'))).toHaveLength(2);
  });

  it('marks a checkpoint the server refused as failed', async () => {
    const project = await selectedProject();
    const checkpoint = await checkpoints.create(project.id, valid);
    const t = setup({
      createCheckpoint: () => {
        throw new ApiError(403, 'sync_mode_forbids_checkpoints', 'metadata only');
      },
    });
    expect(await t.engine.run()).toMatchObject({ kind: 'partial', failed: 1 });
    expect(await store.getItem(checkpointItemId(checkpoint.id))).toMatchObject({
      status: 'failed',
      error: '403 sync_mode_forbids_checkpoints',
    });
  });

  it('reports signed_out when the session expires mid-run', async () => {
    await projects.create({ name: 'P' });
    const t = setup({
      createProject: () => {
        throw new AuthExpiredError();
      },
    });
    expect((await t.engine.run()).kind).toBe('signed_out');
  });

  it('cleans up a failed row whose project was deleted locally', async () => {
    const project = await projects.create({ name: 'P' });
    const t = setup({
      createProject: () => {
        throw new ApiError(400, 'validation_error', 'bad');
      },
    });
    await t.engine.run();
    await projects.remove(project.id);
    await t.engine.run();
    expect(await store.listItems()).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });
});

describe('sync engine: plan and purge', () => {
  it('reports what is waiting', async () => {
    const project = await selectedProject();
    await checkpoints.create(project.id, valid);
    const t = setup();
    const before = await t.engine.plan();
    expect(before.projectUpserts).toHaveLength(1);
    expect(before.checkpointPushes).toHaveLength(1);
    expect(planSize(before)).toBe(2);
    await t.engine.run();
    expect(planSize(await t.engine.plan())).toBe(0);
  });

  it('removes every uploaded project from the server, forgets state, turns sync off, keeps local data', async () => {
    const a = await selectedProject('A');
    const b = await projects.create({ name: 'B' });
    await checkpoints.create(a.id, valid);
    const t = setup();
    await t.engine.run();
    await t.engine.purgeServerData();
    expect(t.calls.filter((call) => call.startsWith('deleteProject:')).sort()).toEqual(
      [`deleteProject:${a.id}`, `deleteProject:${b.id}`].sort(),
    );
    expect(await store.listItems()).toEqual([]);
    expect((await store.getConfig()).enabled).toBe(false);
    expect(await db.projects.count()).toBe(2);
    expect(await db.checkpoints.count()).toBe(1);
  });
});