import type { CheckpointState } from '../storage/db';
import type { ApiClient, ApiResult } from './api-client';

export interface ProjectBody {
  name: string;
  description: string;
  current_goal: string;
  status: string;
  sync_mode: string;
}

export interface CheckpointBody {
  id: string;
  reason: string;
  schema_version: number;
  objective: string;
  state_snapshot: CheckpointState;
  user_edited: boolean;
}

/** The only server operations sync uses. Errors (4xx, 5xx) are thrown as ApiError. */
export interface SyncApi {
  createProject(body: ProjectBody & { id: string }): Promise<ApiResult>;
  patchProject(id: string, body: ProjectBody): Promise<ApiResult>;
  deleteProject(id: string): Promise<ApiResult>;
  createCheckpoint(projectId: string, body: CheckpointBody): Promise<ApiResult>;
  deleteCheckpoint(id: string): Promise<ApiResult>;
}

export function createServerApi(client: Pick<ApiClient, 'request'>): SyncApi {
  const e = encodeURIComponent;
  return {
    createProject: (body) => client.request('POST', '/api/v1/projects/', body),
    patchProject: (id, body) => client.request('PATCH', `/api/v1/projects/${e(id)}/`, body),
    deleteProject: (id) => client.request('DELETE', `/api/v1/projects/${e(id)}/`),
    createCheckpoint: (projectId, body) =>
      client.request('POST', `/api/v1/projects/${e(projectId)}/checkpoints/`, body),
    deleteCheckpoint: (id) => client.request('DELETE', `/api/v1/checkpoints/${e(id)}/`),
  };
}