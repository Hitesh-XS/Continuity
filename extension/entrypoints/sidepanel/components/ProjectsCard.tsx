import { useEffect, useState, type FormEvent } from 'react';
import { withActiveProject, type Settings } from '../../../src/shared/settings';
import { ProjectValidationError } from '../../../src/storage/projects';
import type { useProjects } from '../hooks';
import { projectRepo, settingsStore } from '../services';

interface Props {
  settings: Settings;
  state: ReturnType<typeof useProjects>;
}

function describeError(error: unknown): string {
  if (error instanceof ProjectValidationError) {
    return 'The project name must be 1 to 200 characters.';
  }
  console.error('Continuity: project operation failed', error);
  return 'Could not save to this browser. Your change was not stored.';
}

export function ProjectsCard({ settings, state }: Props) {
  const { projects, error: loadError, refresh } = state;
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeId = settings.activeProjectId;

  // If the active project no longer exists (for example, browser data was cleared), forget it.
  useEffect(() => {
    if (projects && activeId && !projects.some((p) => p.id === activeId)) {
      void settingsStore.update((s) => withActiveProject(s, null));
    }
  }, [projects, activeId]);

  async function guarded(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  }

  const onCreate = (event: FormEvent): void => {
    event.preventDefault();
    void guarded(async () => {
      const project = await projectRepo.create({ name });
      if (!settings.activeProjectId) {
        await settingsStore.update((s) => withActiveProject(s, project.id));
      }
      setName('');
    });
  };

  const onSelect = (id: string): void => {
    void guarded(async () => {
      await settingsStore.update((s) => withActiveProject(s, id));
    });
  };

  const onSetArchived = (id: string, archived: boolean): void => {
    void guarded(async () => {
      await projectRepo.update(id, { status: archived ? 'archived' : 'active' });
      if (archived && id === activeId) {
        await settingsStore.update((s) => withActiveProject(s, null));
      }
    });
  };

  const onSetSyncMode = (id: string, mode: 'metadata_only' | 'selected_content'): void => {
    void guarded(async () => {
      await projectRepo.update(id, { syncMode: mode });
    });
  };

  const onDelete = (id: string): void => {
    void guarded(async () => {
      await projectRepo.remove(id);
      if (id === activeId) await settingsStore.update((s) => withActiveProject(s, null));
      setConfirmDeleteId(null);
    });
  };

  const visible = (projects ?? []).filter((p) => showArchived || p.status !== 'archived');

  return (
    <section className="card">
      <h2>Projects</h2>
      <p className="muted">Stored in this browser. Server sync is optional (see Server sync below).</p>

      <form onSubmit={onCreate} className="row gap">
        <input
          type="text"
          value={name}
          maxLength={200}
          placeholder="New project name"
          aria-label="New project name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={name.trim().length === 0}>
          Create
        </button>
      </form>

      {projects === null && !loadError ? <p className="muted">Loading…</p> : null}
      {projects !== null && visible.length === 0 ? (
        <p className="muted">Create a project to group conversations and checkpoints.</p>
      ) : null}

      <ul className="projects">
        {visible.map((project) => (
          <li key={project.id} className={project.id === activeId ? 'active' : undefined}>
            <div className="row">
              <strong>{project.name}</strong>
              {project.id === activeId ? <span className="tag">Active</span> : null}
              {project.status === 'archived' ? <span className="tag">Archived</span> : null}
            </div>
            <div className="row gap">
              {project.status !== 'archived' && project.id !== activeId ? (
                <button type="button" className="small" onClick={() => onSelect(project.id)}>
                  Use
                </button>
              ) : null}
              {project.status === 'archived' ? (
                <button
                  type="button"
                  className="small"
                  onClick={() => onSetArchived(project.id, false)}
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  className="small secondary"
                  onClick={() => onSetArchived(project.id, true)}
                >
                  Archive
                </button>
              )}
              {confirmDeleteId === project.id ? (
                <>
                  <button type="button" className="small danger" onClick={() => onDelete(project.id)}>
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="small secondary"
                  onClick={() => setConfirmDeleteId(project.id)}
                >
                  Delete
                </button>
              )}
            </div>
            {project.status !== 'archived' ? (
              <div className="field">
                <label htmlFor={`sync-${project.id}`}>Server copy (only if sync is on)</label>
                <select
                  id={`sync-${project.id}`}
                  value={project.syncMode === 'metadata_only' ? 'metadata_only' : 'selected_content'}
                  onChange={(event) =>
                    onSetSyncMode(
                      project.id,
                      event.target.value === 'selected_content' ? 'selected_content' : 'metadata_only',
                    )
                  }
                >
                  <option value="metadata_only">Project details only</option>
                  <option value="selected_content">Details + checkpoints</option>
                </select>
                {project.syncMode !== 'metadata_only' ? (
                  <p className="muted small-text">
                    Checkpoints for this project are uploaded: objective, decisions, completed work,
                    blockers, next action, notes and the titles of linked conversations. Chat
                    messages are never uploaded.
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <label className="check">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Show archived
      </label>

      {loadError || error ? (
        <p className="error" role="alert">
          {loadError ?? error}
        </p>
      ) : null}
    </section>
  );
}