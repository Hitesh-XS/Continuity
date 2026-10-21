import type { ApiResult } from '../src/sync/api-client';
import type { CheckpointBody, ProjectBody, SyncApi } from '../src/sync/server-api';

type Result = ApiResult | Promise<ApiResult>;

export interface Handlers {
  createProject?: (body: ProjectBody & { id: string }) => Result;
  patchProject?: (id: string, body: ProjectBody) => Result;
  deleteProject?: (id: string) => Result;
  createCheckpoint?: (projectId: string, body: CheckpointBody) => Result;
  deleteCheckpoint?: (id: string) => Result;
}

const ok = (status = 200, data: unknown = {}): ApiResult => ({ status, data });

/** A scripted stand-in for the server that records every call. Handlers may throw ApiError. */
export function fakeApi(handlers: Handlers = {}) {
  const calls: string[] = [];
  const checkpointBodies: CheckpointBody[] = [];
  const api: SyncApi = {
    async createProject(body) {
      calls.push(`createProject:${body.id}`);
      return handlers.createProject ? handlers.createProject(body) : ok(201);
    },
    async patchProject(id, body) {
      calls.push(`patchProject:${id}`);
      return handlers.patchProject ? handlers.patchProject(id, body) : ok(200);
    },
    async deleteProject(id) {
      calls.push(`deleteProject:${id}`);
      return handlers.deleteProject ? handlers.deleteProject(id) : ok(204, null);
    },
    async createCheckpoint(projectId, body) {
      calls.push(`createCheckpoint:${body.id}`);
      checkpointBodies.push(body);
      return handlers.createCheckpoint
        ? handlers.createCheckpoint(projectId, body)
        : ok(201, { version: checkpointBodies.length });
    },
    async deleteCheckpoint(id) {
      calls.push(`deleteCheckpoint:${id}`);
      return handlers.deleteCheckpoint ? handlers.deleteCheckpoint(id) : ok(204, null);
    },
  };
  return { api, calls, checkpointBodies };
}