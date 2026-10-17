import { localArea } from '../../src/extension/chrome-storage';
import { createSettingsStore } from '../../src/shared/settings-store';
import { createDb } from '../../src/storage/db';
import { createProjectRepository } from '../../src/storage/projects';

export const db = createDb();
export const projectRepo = createProjectRepository(db);
export const settingsStore = createSettingsStore(localArea);