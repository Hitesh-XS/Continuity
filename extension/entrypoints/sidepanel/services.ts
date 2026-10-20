import { createConversationRepository } from '../../src/capture/conversations';
import { createCheckpointRepository } from '../../src/checkpoints/repository';
import { localArea } from '../../src/extension/chrome-storage';
import { createSettingsStore } from '../../src/shared/settings-store';
import { createDb } from '../../src/storage/db';
import { createProjectRepository } from '../../src/storage/projects';

export const db = createDb();
export const projectRepo = createProjectRepository(db);
export const conversationRepo = createConversationRepository(db);
export const checkpointRepo = createCheckpointRepository(db);
export const settingsStore = createSettingsStore(localArea);