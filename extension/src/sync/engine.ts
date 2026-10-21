import { hashText } from '../capture/snapshot';
import type {
  ContinuityDb,
  LocalCheckpoint,
  LocalProject,
  SyncItemRecord,
  SyncResultKind,
} from '../storage/db';
import { ApiError, AuthExpiredError, isTransient } from './errors';
import { tryLock } from './locks';
import type { CheckpointBody, ProjectBody, SyncApi } from './server-api';
import type { SyncStore } from './store';

export const projectItemId = (id: string): string => `project:${id}`;
export const checkpointItemId = (id: string): string => `checkpoint:${id}`;

export function projectBody(project: LocalProject): ProjectBody {
  return {
    name: project.name,
    description: project.description,
    current_goal: project.currentGoal,
    status: project.status,
    sync_mode: project.syncMode,
  };
}

export function checkpointBody(checkpoint: LocalCheckpoint): CheckpointBody {
  return {
    id: checkpoint.id,
    reason: checkpoint.reason,
    schema_version: checkpoint.schemaVersion,
    objective: checkpoint.objective,
    state_snapshot: checkpoint.state,
    user_edited: checkpoint.userEdited,
  };
}

export const projectHash = (project: LocalProject): Promise<string> =>
  hashText(JSON.stringify(projectBody(project)));

export interface SyncPlan {
  projectUpserts: { project: LocalProject; hash: string }[];
  checkpointPushes: LocalCheckpoint[];
  checkpointDeletes: SyncItemRecord[];
  projectDeletes: SyncItemRecord[];
  /** Failed rows that are not scheduled for another attempt. */
  failed: number;
  /** Failed rows whose local item no longer exists. */
  staleFailed: SyncItemRecord[];
}

export const planSize = (plan: SyncPlan): number =>
  plan.projectUpserts.length +
  plan.checkpointPushes.length +
  plan.checkpointDeletes.length +
  plan.projectDeletes.length;

export interface RunResult {
  kind: SyncResultKind | 'disabled' | 'busy';
  synced: number;
  failed: number;
  waiting: number;
}

interface Counters {
  synced: number;
  failed: number;
  waiting: number;
}

export interface SyncEngineDeps {
  db: ContinuityDb;
  store: SyncStore;
  api: SyncApi;
  now?: () => string;
}

export function createSyncEngine(deps: SyncEngineDeps) {
  const { db, store, api } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  function makeItem(
    kind: 'project' | 'checkpoint',
    entityId: string,
    status: 'synced' | 'failed',
    hash: string,
    serverVersion: number | null,
    parentId: string | null,
    error: string | null = null,
  ): SyncItemRecord {
    return {
      id: `${kind}:${entityId}`,
      kind,
      entityId,
      parentId,
      status,
      hash,
      serverVersion,
      error,
      updatedAt: now(),
    };
  }

  /** Compares local data with what we know the server has. Read-only. */
  async function plan(): Promise<SyncPlan> {
    const [projects, checkpoints, items] = await Promise.all([
      db.projects.toArray(),
      db.checkpoints.toArray(),
      db.syncItems.toArray(),
    ]);
    const itemById = new Map(items.map((item) => [item.id, item] as const));
    const projectById = new Map(projects.map((project) => [project.id, project] as const));
    const checkpointIds = new Set(checkpoints.map((checkpoint) => checkpoint.id));
    let failed = 0;

    const projectUpserts: SyncPlan['projectUpserts'] = [];
    for (const project of projects) {
      const hash = await projectHash(project);
      const item = itemById.get(projectItemId(project.id));
      if (!item || item.hash !== hash) projectUpserts.push({ project, hash });
      else if (item.status === 'failed') failed += 1;
    }

    const checkpointPushes: LocalCheckpoint[] = [];
    for (const checkpoint of checkpoints) {
      const item = itemById.get(checkpointItemId(checkpoint.id));
      if (item) {
        if (item.status === 'failed') failed += 1;
        continue;
      }
      const project = projectById.get(checkpoint.projectId);
      if (project && project.syncMode !== 'metadata_only') checkpointPushes.push(checkpoint);
    }

    const projectDeletes = items.filter(
      (item) => item.kind === 'project' && item.status === 'synced' && !projectById.has(item.entityId),
    );
    const doomedProjects = new Set(projectDeletes.map((item) => item.entityId));
    const checkpointDeletes = items.filter(
      (item) =>
        item.kind === 'checkpoint' &&
        item.status === 'synced' &&
        !checkpointIds.has(item.entityId) &&
        !(item.parentId !== null && doomedProjects.has(item.parentId)),
    );
    const staleFailed = items.filter(
      (item) =>
        item.status === 'failed' &&
        (item.kind === 'project' ? !projectById.has(item.entityId) : !checkpointIds.has(item.entityId)),
    );

    return { projectUpserts, checkpointPushes, checkpointDeletes, projectDeletes, failed, staleFailed };
  }

  async function upsertProject(project: LocalProject, knownOnServer: boolean): Promise<void> {
    const body = projectBody(project);
    if (knownOnServer) {
      try {
        await api.patchProject(project.id, body);
        return;
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        // The server lost it: fall through and create it again.
      }
    }
    const created = await api.createProject({ id: project.id, ...body });
    // 200 means this account already had a project with this id: our local values win.
    if (created.status === 200) await api.patchProject(project.id, body);
  }

  /** 'failed' means the server refused permanently; transient errors are thrown. */
  async function deleteOnServer(call: () => Promise<unknown>): Promise<'ok' | 'failed'> {
    try {
      await call();
      return 'ok';
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'ok'; // already gone
      if (error instanceof ApiError && !isTransient(error)) return 'failed';
      throw error;
    }
  }

  async function execute(current: SyncPlan, counters: Counters): Promise<void> {
    for (const row of current.staleFailed) await store.deleteItem(row.id);

    for (const { project, hash } of current.projectUpserts) {
      const existing = await store.getItem(projectItemId(project.id));
      try {
        await upsertProject(project, existing?.status === 'synced');
        await store.putItem(makeItem('project', project.id, 'synced', hash, null, null));
        counters.synced += 1;
      } catch (error) {
        if (error instanceof ApiError && !isTransient(error)) {
          const reason = `${error.status} ${error.code}`;
          await store.putItem(makeItem('project', project.id, 'failed', hash, null, null, reason));
          counters.failed += 1;
          continue;
        }
        throw error;
      }
    }

    for (const checkpoint of current.checkpointPushes) {
      const parent = await store.getItem(projectItemId(checkpoint.projectId));
      if (parent?.status !== 'synced') {
        counters.waiting += 1; // its project is not on the server yet
        continue;
      }
      try {
        const response = await api.createCheckpoint(checkpoint.projectId, checkpointBody(checkpoint));
        const version = (response.data as { version?: unknown } | null)?.version;
        await store.putItem(
          makeItem(
            'checkpoint',
            checkpoint.id,
            'synced',
            'immutable',
            typeof version === 'number' ? version : null,
            checkpoint.projectId,
          ),
        );
        counters.synced += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // The server no longer has the project: forget it so the next run re-creates it.
          await store.deleteItem(projectItemId(checkpoint.projectId));
          counters.waiting += 1;
          continue;
        }
        if (error instanceof ApiError && !isTransient(error)) {
          const reason = `${error.status} ${error.code}`;
          await store.putItem(
            makeItem('checkpoint', checkpoint.id, 'failed', 'immutable', null, checkpoint.projectId, reason),
          );
          counters.failed += 1;
          continue;
        }
        throw error;
      }
    }

    for (const item of current.checkpointDeletes) {
      const outcome = await deleteOnServer(() => api.deleteCheckpoint(item.entityId));
      await store.deleteItem(item.id);
      if (outcome === 'ok') counters.synced += 1;
      else counters.failed += 1;
    }

    for (const item of current.projectDeletes) {
      const outcome = await deleteOnServer(() => api.deleteProject(item.entityId));
      await store.deleteItem(item.id);
      await store.deleteItemsByParent(item.entityId); // the server deleted its checkpoints too
      if (outcome === 'ok') counters.synced += 1;
      else counters.failed += 1;
    }
  }

  async function doRun(): Promise<RunResult> {
    const config = await store.getConfig();
    const current = await plan();
    const counters: Counters = { synced: 0, failed: 0, waiting: 0 };
    let kind: SyncResultKind = 'ok';
    let lastError: string | null = null;

    try {
      await execute(current, counters);
      const failedTotal = current.failed + counters.failed;
      if (failedTotal > 0 || counters.waiting > 0) {
        kind = 'partial';
        lastError = failedTotal > 0 ? `${failedTotal} item(s) failed` : null;
      }
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        kind = 'signed_out';
        lastError = 'Signed out';
      } else if (isTransient(error)) {
        kind = 'offline';
        lastError = 'Server unreachable';
      } else {
        kind = 'error';
        lastError = 'Unexpected error';
        // The error type only, never anything that could contain content.
        console.error('Continuity: sync failed unexpectedly', error instanceof Error ? error.name : 'Error');
      }
    }

    // Only write when something happened or the outcome changed, so status updates cannot loop.
    if (planSize(current) > 0 || config.lastResult !== kind || config.lastError !== lastError) {
      await store.updateConfig({ lastRunAt: now(), lastResult: kind, lastError });
    }
    return {
      kind,
      synced: counters.synced,
      failed: current.failed + counters.failed,
      waiting: counters.waiting,
    };
  }

  async function runExclusive(): Promise<RunResult> {
    const config = await store.getConfig();
    if (!config.enabled) return { kind: 'disabled', synced: 0, failed: 0, waiting: 0 };
    if (!(await store.getAuth())) return { kind: 'signed_out', synced: 0, failed: 0, waiting: 0 };
    const guarded = await tryLock('continuity-sync', doRun); // one run across all extension windows
    return guarded.ran ? guarded.value : { kind: 'busy', synced: 0, failed: 0, waiting: 0 };
  }

  let inFlight: Promise<RunResult> | null = null;
  /** Safe to call as often as you like: concurrent calls share one run. */
  function run(): Promise<RunResult> {
    if (inFlight) return inFlight;
    const promise = runExclusive().finally(() => {
      inFlight = null;
    });
    inFlight = promise;
    return promise;
  }

  /** Forget failures so the next run tries those items again. */
  async function retryFailed(): Promise<void> {
    await store.deleteFailedItems();
  }

  /**
   * Deletes every project this browser uploaded (the server removes their checkpoints too),
   * forgets all sync state and turns sync off. Local data is untouched.
   */
  async function purgeServerData(): Promise<{ deleted: number }> {
    if (!(await store.getAuth())) throw new AuthExpiredError();
    let deleted = 0;
    for (const item of await store.listItems()) {
      if (item.kind !== 'project' || item.status !== 'synced') continue;
      await deleteOnServer(() => api.deleteProject(item.entityId)); // transient errors abort here
      deleted += 1;
    }
    await store.clearItems();
    await store.updateConfig({ enabled: false, consentAt: null, lastResult: null, lastError: null });
    return { deleted };
  }

  return { plan, run, retryFailed, purgeServerData };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;