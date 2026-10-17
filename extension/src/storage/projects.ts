import { z } from 'zod';
import {
  PROJECT_SCHEMA_VERSION,
  PROJECT_STATUSES,
  SYNC_MODES,
  type ContinuityDb,
  type LocalProject,
} from './db';

export class ProjectValidationError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Invalid project field(s): ${fields.join(', ')}`);
    this.name = 'ProjectValidationError';
    this.fields = fields;
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = 'ProjectNotFoundError';
  }
}

// Limits mirror the Django model. No .default() here: defaults inside optional
// fields can silently reset values on a partial update.
const nameField = z.string().trim().min(1).max(200);

const CreateProjectSchema = z.object({
  name: nameField,
  description: z.string().max(5000).optional(),
  currentGoal: z.string().max(2000).optional(),
  syncMode: z.enum(SYNC_MODES).optional(),
});

const UpdateProjectSchema = z.object({
  name: nameField.optional(),
  description: z.string().max(5000).optional(),
  currentGoal: z.string().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  syncMode: z.enum(SYNC_MODES).optional(),
});

function fieldNames(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join('.') || 'input');
}

export interface RepositoryOptions {
  now?: () => string;
  newId?: () => string;
}

export function createProjectRepository(db: ContinuityDb, options: RepositoryOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());

  async function create(raw: unknown): Promise<LocalProject> {
    const parsed = CreateProjectSchema.safeParse(raw);
    if (!parsed.success) throw new ProjectValidationError(fieldNames(parsed.error));

    const timestamp = now();
    const project: LocalProject = {
      id: newId(),
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      currentGoal: parsed.data.currentGoal ?? '',
      status: 'active',
      syncMode: parsed.data.syncMode ?? 'metadata_only',
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    };
    await db.projects.add(project);
    return project;
  }

  async function list(listOptions: { includeArchived?: boolean } = {}): Promise<LocalProject[]> {
    const all = await db.projects.orderBy('updatedAt').reverse().toArray();
    return listOptions.includeArchived ? all : all.filter((p) => p.status !== 'archived');
  }

  async function get(id: string): Promise<LocalProject | undefined> {
    return db.projects.get(id);
  }

  async function update(id: string, rawPatch: unknown): Promise<LocalProject> {
    const parsed = UpdateProjectSchema.safeParse(rawPatch);
    if (!parsed.success) throw new ProjectValidationError(fieldNames(parsed.error));
    const { name, description, currentGoal, status, syncMode } = parsed.data;

    return db.transaction('rw', db.projects, async () => {
      const existing = await db.projects.get(id);
      if (!existing) throw new ProjectNotFoundError(id);
      // Only these fields can change; id and createdAt are never taken from the patch.
      const updated: LocalProject = {
        ...existing,
        name: name ?? existing.name,
        description: description ?? existing.description,
        currentGoal: currentGoal ?? existing.currentGoal,
        status: status ?? existing.status,
        syncMode: syncMode ?? existing.syncMode,
        updatedAt: now(),
      };
      await db.projects.put(updated);
      return updated;
    });
  }

  async function remove(id: string): Promise<void> {
    await db.projects.delete(id);
  }

  return { create, list, get, update, remove };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;