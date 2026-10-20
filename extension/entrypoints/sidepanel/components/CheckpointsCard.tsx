import { useEffect, useRef, useState } from 'react';
import { renderCheckpointMarkdown } from '../../../src/checkpoints/markdown';
import {
  CheckpointNotFoundError,
  CheckpointProjectNotFoundError,
  CheckpointValidationError,
} from '../../../src/checkpoints/repository';
import { linesToList } from '../../../src/checkpoints/schema';
import type { LocalCheckpoint, LocalConversation, LocalProject } from '../../../src/storage/db';
import { useCheckpoints } from '../hooks';
import { checkpointRepo } from '../services';

interface FormState {
  objective: string;
  nextAction: string;
  decisions: string;
  completed: string;
  blockers: string;
  notes: string;
}

const EMPTY: FormState = {
  objective: '',
  nextAction: '',
  decisions: '',
  completed: '',
  blockers: '',
  notes: '',
};

function formFrom(checkpoint: LocalCheckpoint): FormState {
  return {
    objective: checkpoint.objective,
    nextAction: checkpoint.state.nextAction,
    decisions: checkpoint.state.decisions.join('\n'),
    completed: checkpoint.state.completed.join('\n'),
    blockers: checkpoint.state.blockers.join('\n'),
    notes: checkpoint.state.notes,
  };
}

function describeError(error: unknown): string {
  if (error instanceof CheckpointValidationError) {
    const fields = [...new Set(error.fields.map((field) => field.split('.')[0]))];
    return `Please check: ${fields.join(', ')}. Objective and next action are required.`;
  }
  if (error instanceof CheckpointProjectNotFoundError) return 'That project no longer exists.';
  if (error instanceof CheckpointNotFoundError) return 'That checkpoint no longer exists.';
  console.error('Continuity: checkpoint operation failed', error);
  return 'Could not save to this browser. Your change was not stored.';
}

function fileNameFor(project: LocalProject | undefined, checkpoint: LocalCheckpoint): string {
  const base = (project?.name ?? 'project').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
  return `${base || 'project'}-checkpoint-v${checkpoint.version}.md`;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  projectId: string | null;
  project: LocalProject | undefined;
  conversations: LocalConversation[] | null;
}

export function CheckpointsCard({ projectId, project, conversations }: Props) {
  const { checkpoints, error: loadError, refresh } = useCheckpoints(projectId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialisedFor = useRef<string | null>(null);

  // Start the form from the latest checkpoint of the selected project (once per project).
  useEffect(() => {
    if (!projectId) {
      initialisedFor.current = null;
      setForm(EMPTY);
      setSelected([]);
      return;
    }
    if (checkpoints === null || initialisedFor.current === projectId) return;
    initialisedFor.current = projectId;
    const latest = checkpoints[0];
    if (latest) {
      setForm(formFrom(latest));
      setSelected(latest.state.sources.map((source) => source.conversationId));
    } else {
      setForm(EMPTY);
      setSelected(
        (conversations ?? [])
          .filter((conversation) => conversation.projectId === projectId)
          .map((conversation) => conversation.id),
      );
    }
  }, [projectId, checkpoints, conversations]);

  if (!projectId) {
    return (
      <section className="card">
        <h2>Checkpoints</h2>
        <p className="muted">Select or create a project above to save checkpoints.</p>
      </section>
    );
  }

  const set = (key: keyof FormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(describeError(e));
    }
  }

  const onSave = (): void => {
    if (!projectId) return;
    void run(async () => {
      const created = await checkpointRepo.create(projectId, {
        objective: form.objective,
        nextAction: form.nextAction,
        decisions: linesToList(form.decisions),
        completed: linesToList(form.completed),
        blockers: linesToList(form.blockers),
        notes: form.notes,
        conversationIds: selected,
      });
      await refresh();
      setNotice(`Saved version ${created.version}.`);
    });
  };

  const onRestore = (id: string): void => {
    void run(async () => {
      const restored = await checkpointRepo.restore(id);
      await refresh();
      setNotice(`Restored as new version ${restored.version}.`);
    });
  };

  const onDelete = (id: string): void => {
    void run(async () => {
      await checkpointRepo.remove(id);
      setConfirmId(null);
      if (openId === id) setOpenId(null);
      await refresh();
    });
  };

  const onCopy = (checkpoint: LocalCheckpoint): void => {
    void run(async () => {
      try {
        await navigator.clipboard.writeText(renderCheckpointMarkdown(project ?? { name: '' }, checkpoint));
        setNotice(`Copied version ${checkpoint.version} as Markdown.`);
      } catch {
        setError('Could not copy. Use Download instead.');
      }
    });
  };

  const onDownload = (checkpoint: LocalCheckpoint): void => {
    downloadText(
      fileNameFor(project, checkpoint),
      renderCheckpointMarkdown(project ?? { name: '' }, checkpoint),
    );
  };

  const toggleSource = (id: string): void =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <section className="card">
      <h2>Checkpoints</h2>
      <p className="muted">
        {project?.name ?? 'This project'}: saved only in this browser. Each save creates a new
        version; saved versions never change.
      </p>

      <div className="field">
        <label htmlFor="cp-objective">Objective (required)</label>
        <input
          id="cp-objective"
          type="text"
          maxLength={2000}
          value={form.objective}
          onChange={(event) => set('objective')(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cp-next">Next action (required)</label>
        <textarea
          id="cp-next"
          rows={2}
          maxLength={2000}
          value={form.nextAction}
          onChange={(event) => set('nextAction')(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cp-decisions">Decisions (one per line)</label>
        <textarea
          id="cp-decisions"
          rows={3}
          value={form.decisions}
          onChange={(event) => set('decisions')(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cp-completed">Completed (one per line)</label>
        <textarea
          id="cp-completed"
          rows={3}
          value={form.completed}
          onChange={(event) => set('completed')(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cp-blockers">Blockers (one per line)</label>
        <textarea
          id="cp-blockers"
          rows={2}
          value={form.blockers}
          onChange={(event) => set('blockers')(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cp-notes">Notes</label>
        <textarea
          id="cp-notes"
          rows={3}
          value={form.notes}
          onChange={(event) => set('notes')(event.target.value)}
        />
      </div>

      <div className="field">
        <span>Link captured conversations as sources (references only)</span>
        {(conversations ?? []).length === 0 ? (
          <p className="muted small-text">No captured conversations yet.</p>
        ) : (
          <ul className="sources">
            {(conversations ?? []).map((conversation) => (
              <li key={conversation.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(conversation.id)}
                    onChange={() => toggleSource(conversation.id)}
                  />
                  {conversation.title || '(untitled)'} ({conversation.messageCount} msgs)
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" onClick={onSave}>
        Save checkpoint
      </button>

      <h3>History</h3>
      {checkpoints === null && !loadError ? <p className="muted">Loading…</p> : null}
      {checkpoints !== null && checkpoints.length === 0 ? (
        <p className="muted">No checkpoints yet.</p>
      ) : null}

      <ul className="projects">
        {(checkpoints ?? []).map((checkpoint) => (
          <li key={checkpoint.id}>
            <div className="row">
              <strong>Version {checkpoint.version}</strong>
              <span className="tag">{checkpoint.reason}</span>
            </div>
            <p className="muted small-text">
              {new Date(checkpoint.createdAt).toLocaleString()}
              {checkpoint.restoredFromVersion !== null
                ? ` · restored from v${checkpoint.restoredFromVersion}`
                : ''}
            </p>
            <div className="row gap">
              <button
                type="button"
                className="small"
                onClick={() => setOpenId(openId === checkpoint.id ? null : checkpoint.id)}
              >
                {openId === checkpoint.id ? 'Hide' : 'View'}
              </button>
              <button type="button" className="small secondary" onClick={() => onCopy(checkpoint)}>
                Copy
              </button>
              <button type="button" className="small secondary" onClick={() => onDownload(checkpoint)}>
                Download
              </button>
              <button type="button" className="small secondary" onClick={() => onRestore(checkpoint.id)}>
                Restore
              </button>
              {confirmId === checkpoint.id ? (
                <>
                  <button type="button" className="small danger" onClick={() => onDelete(checkpoint.id)}>
                    Confirm delete
                  </button>
                  <button type="button" className="small secondary" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="small secondary"
                  onClick={() => setConfirmId(checkpoint.id)}
                >
                  Delete
                </button>
              )}
            </div>
            {openId === checkpoint.id ? (
              // Rendered as plain text: titles and notes are never interpreted as markup.
              <pre className="preview">
                {renderCheckpointMarkdown(project ?? { name: '' }, checkpoint)}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>

      {notice ? <p className="ok">{notice}</p> : null}
      {loadError || error ? (
        <p className="error" role="alert">
          {loadError ?? error}
        </p>
      ) : null}
    </section>
  );
}