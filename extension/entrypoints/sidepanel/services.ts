import { createConversationRepository } from '../../src/capture/conversations';
import { createCheckpointRepository } from '../../src/checkpoints/repository';
import { localArea } from '../../src/extension/chrome-storage';
import { API_BASE_URL } from '../../src/shared/api-config';
import { createSettingsStore } from '../../src/shared/settings-store';
import { createDb } from '../../src/storage/db';
import { createProjectRepository } from '../../src/storage/projects';
import { createApiClient } from '../../src/sync/api-client';
import { createSyncEngine } from '../../src/sync/engine';
import { createServerApi } from '../../src/sync/server-api';
import { createSyncSession } from '../../src/sync/session';
import { createSyncStore } from '../../src/sync/store';
import { createMemoryRepository } from '../../src/memory/repository';

export const db = createDb();
export const projectRepo = createProjectRepository(db);
export const conversationRepo = createConversationRepository(db);
export const checkpointRepo = createCheckpointRepository(db);
export const settingsStore = createSettingsStore(localArea);
export const memoryRepo = createMemoryRepository(db);

export const syncStore = createSyncStore(db);
export const apiClient = createApiClient({ baseUrl: API_BASE_URL, store: syncStore });
export const syncEngine = createSyncEngine({ db, store: syncStore, api: createServerApi(apiClient) });
export const syncSession = createSyncSession({ store: syncStore, auth: apiClient });