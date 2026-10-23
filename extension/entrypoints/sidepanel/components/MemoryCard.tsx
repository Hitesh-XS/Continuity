import { useState, type FormEvent } from 'react';
import { exportMemoryJson, renderMemoryMarkdown } from '../../../src/memory/export';
import { SETTABLE } from '../../../src/memory/rules';
import {
  MEMORY_KINDS,
  type LocalMemoryItem,
  type MemoryKind,
  type MemoryStatus,
} from '../../../src/memory/types';
import type { LocalProject } from '../../../src/storage/db';
import { downloadText } from '../download';
import {
  describeMemoryError,
  useMemoryEvidence,
  useMemoryHistory,
  useMemoryItems,
} from '../memory-hooks';
import { memoryRepo } from '../services';

export interface LinkTarget {
  itemId: string;
  text: string;
}

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: 'Fact',
  preference: 'Preference',
  decision: 'Decision',
  hypothesis: 'Hypothesis',
  task: 'Task',
  blocker: 'Blocker',
};

const STATUS_LABEL: Record<MemoryStatus, string> = {
  proposed: 'Unverified',
  confirmed: 'Confirmed',
  open: 'Open',
  done: 'Done',
  resolved: 'Resolved',
  disputed: 'Disputed',
  superseded: 'Superseded',
  rejected: 'Rejected',
};

const ACTION_LABEL: Record<MemoryStatus, string> = {
  proposed: 'Mark unverified',
  confirmed: 'Confirm',
  open: 'Reopen',
  done: 'Mark done',
  resolved: 'Mark resolved',
  rejected: 'Reject',
  disputed: '',
  superseded: '',
};

const FILTERS = [
  ['current', 'Current'],
  ['closed', 'Done / resolved'],
  ['history', 'Superseded / rejected'],
  ['all', 'All'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const FILTER_STATUSES: Record<Filter, readonly MemoryStatus[] | null> = {
  current: ['proposed', 'confirmed', 'open', 'disputed'],
  closed: ['done', 'resolved'],
  history: ['superseded', 'rejected'],
  all: null,
};

const SHOWN_CHARS = 200;
const clip = (text: string): string =>
  text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}…` : text;

type Run = (action: () => Promise<unknown>, success?: string) => Promise<boolean>;

interface RowProps {
  item: LocalMemoryItem;
  items: LocalMemoryItem[];
  run: Run;
  linkTarget: LinkTarget | null;
  onLinkTarget: (target: LinkTarget | null) => void;
}

function MemoryRow({ item, items, run, linkTarget, onLinkTarget }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const [draftTopic, setDraftTopic] = useState(item.topic);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const history = useMemoryHistory(showHistory ? item.id : null);
  const evidence = useMemoryEvidence(showEvidence ? item.id : null);

  const textOf = (id: string): string => items.find((other) => other.id === id)?.text ?? '(deleted)';
  const readOnly = item.status === 'superseded';
  const canMove = !readOnly && item.status !== 'disputed';
  const targets = canMove ? SETTABLE[item.kind].filter((status) => status !== item.status) : [];
  const badge =
    item.status === 'confirmed' ? 'tag good' : item.status === 'disputed' ? 'tag warn' : 'tag';

  return (
    <li>
      <div className="row">
        <strong>{KIND_LABEL[item.kind]}</strong>
        <span className={badge}>{STATUS_LABEL[item.status]}</span>
      </div>
      {/* Item text is plain text: it is never interpreted as markup. */}
      <p className="memtext">{item.text}</p>
      {item.topic ? <p className="muted small-text">Topic: {item.topic}</p> : null}
      {item.origin === 'extracted' ? (
        <p className="muted small-text">Suggested automatically: review before relying on it.</p>
      ) : null}
      {item.status === 'disputed'
        ? item.conflictsWith.map((id) => (
            <p key={id} className="muted small-text">
              Conflicts with: {clip(textOf(id))}
            </p>
          ))
        : null}
      {item.status === 'superseded' && item.supersededById ? (
        <p className="muted small-text">Replaced by: {clip(textOf(item.supersededById))}</p>
      ) : null}

      <div className="row gap">
        {targets.map((status) => (
          <button
            key={status}
            type="button"
            className="small"
            onClick={() => void run(() => memoryRepo.setStatus(item.id, status))}
          >
            {ACTION_LABEL[status]}
          </button>
        ))}
        {item.status === 'disputed' ? (
          <button
            type="button"
            className="small"
            onClick={() => void run(() => memoryRepo.resolveConflict(item.id), 'Conflict resolved.')}
          >
            Keep this one
          </button>
        ) : null}
        {!readOnly ? (
          <>
            <button
              type="button"
              className="small secondary"
              onClick={() => {
                setDraftText(item.text);
                setDraftTopic(item.topic);
                setEditing(!editing);
                setReplacing(false);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="small secondary"
              onClick={() => {
                setReplacing(!replacing);
                setEditing(false);
              }}
            >
              Replace
            </button>
            <button
              type="button"
              className="small secondary"
              onClick={() => onLinkTarget({ itemId: item.id, text: clip(item.text) })}
            >
              Link evidence
            </button>
          </>
        ) : null}
        <button type="button" className="small secondary" onClick={() => setShowEvidence(!showEvidence)}>
          Evidence ({item.evidence.length})
        </button>
        <button type="button" className="small secondary" onClick={() => setShowHistory(!showHistory)}>
          History
        </button>
        {confirmDelete ? (
          <>
            <button
              type="button"
              className="small danger"
              onClick={() => void run(() => memoryRepo.remove(item.id))}
            >
              Confirm delete
            </button>
            <button type="button" className="small secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="small secondary" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>

      {linkTarget?.itemId === item.id ? (
        <p className="banner small-text">
          Linking evidence: open a conversation under &quot;Captured conversations&quot;, click View,
          then &quot;Use as evidence&quot; on a message.{' '}
          <button type="button" className="small secondary" onClick={() => onLinkTarget(null)}>
            Done
          </button>
        </p>
      ) : null}

      {editing ? (
        <div className="field">
          <label htmlFor={`edit-${item.id}`}>Text</label>
          <textarea
            id={`edit-${item.id}`}
            rows={3}
            maxLength={1000}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          <label htmlFor={`edit-topic-${item.id}`}>Topic (optional)</label>
          <input
            id={`edit-topic-${item.id}`}
            type="text"
            maxLength={100}
            value={draftTopic}
            onChange={(event) => setDraftTopic(event.target.value)}
          />
          <div className="row gap">
            <button
              type="button"
              className="small"
              onClick={() =>
                void run(() => memoryRepo.update(item.id, { text: draftText, topic: draftTopic })).then(
                  (ok) => ok && setEditing(false),
                )
              }
            >
              Save edit
            </button>
            <button type="button" className="small secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {replacing ? (
        <div className="field">
          <label htmlFor={`rep-${item.id}`}>New text (the current item is kept as history)</label>
          <textarea
            id={`rep-${item.id}`}
            rows={3}
            maxLength={1000}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <div className="row gap">
            <button
              type="button"
              className="small"
              disabled={replacement.trim() === ''}
              onClick={() =>
                void run(() => memoryRepo.supersede(item.id, { text: replacement }), 'Replaced.').then(
                  (ok) => {
                    if (ok) {
                      setReplacing(false);
                      setReplacement('');
                    }
                  },
                )
              }
            >
              Replace
            </button>
            <button type="button" className="small secondary" onClick={() => setReplacing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showEvidence ? (
        <div className="messages">
          {evidence === null ? <p className="muted">Loading…</p> : null}
          {evidence !== null && evidence.length === 0 ? (
            <p className="muted small-text">No linked messages.</p>
          ) : null}
          {(evidence ?? []).map((view) => (
            <div key={view.ref.messageId} className="msg-wrap">
              <span className="role">
                {view.state === 'ok'
                  ? 'Linked message'
                  : view.state === 'changed'
                    ? 'Linked message: changed since you linked it'
                    : 'Linked message: no longer stored'}
              </span>
              <div className="msg">
                {view.message ? clip(view.message.text) : '(the conversation was deleted)'}
              </div>
              {!readOnly ? (
                <button
                  type="button"
                  className="small secondary"
                  onClick={() => void run(() => memoryRepo.removeEvidence(item.id, view.ref.messageId))}
                >
                  Unlink
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {showHistory ? (
        <ul className="history">
          {history === null ? <li>Loading…</li> : null}
          {(history ?? []).map((entry) => (
            <li key={entry.id}>
              {new Date(entry.at).toLocaleString()} · {entry.action.replace(/_/g, ' ')}
              {entry.fromStatus || entry.toStatus
                ? ` (${entry.fromStatus ?? '—'} → ${entry.toStatus ?? '—'})`
                : ''}
              {entry.fromText ? ` · was: ${clip(entry.fromText)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface Props {
  projectId: string | null;
  project: LocalProject | undefined;
  linkTarget: LinkTarget | null;
  onLinkTarget: (target: LinkTarget | null) => void;
}

export function MemoryCard({ projectId, project, linkTarget, onLinkTarget }: Props) {
  const items = useMemoryItems(projectId);
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const [filter, setFilter] = useState<Filter>('current');
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!projectId) {
    return (
      <section className="card">
        <h2>Project memory</h2>
        <p className="muted">Select or create a project above to keep memory for it.</p>
      </section>
    );
  }

  const run: Run = async (action, success) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setError(describeMemoryError(e));
      return false;
    }
  };

  const onAdd = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      await memoryRepo.create(projectId, { kind, text, topic });
      setText('');
      setTopic('');
    }, 'Added.');
  };

  const onExport = (format: 'md' | 'json'): void => {
    void run(async () => {
      const [all, history] = await Promise.all([
        memoryRepo.list(projectId),
        memoryRepo.historyForProject(projectId),
      ]);
      const stamp = new Date().toISOString();
      const base = (project?.name ?? 'project').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'project';
      if (format === 'md') {
        downloadText(
          `${base}-memory.md`,
          renderMemoryMarkdown(project ?? { name: '' }, all, { exportedAt: stamp }),
          'text/markdown',
        );
      } else {
        downloadText(
          `${base}-memory.json`,
          exportMemoryJson(project ?? { id: projectId, name: '' }, all, history, stamp),
          'application/json',
        );
      }
    });
  };

  const statuses = FILTER_STATUSES[filter];
  const visible = [...(items ?? [])]
    .filter((item) => statuses === null || statuses.includes(item.status))
    .reverse();
  const disputedCount = (items ?? []).filter((item) => item.status === 'disputed').length;

  return (
    <section className="card">
      <h2>Project memory</h2>
      <p className="muted">
        {project?.name ?? 'This project'}: saved only in this browser, never uploaded. Only
        &quot;Confirmed&quot; items are treated as verified.
      </p>

      <form onSubmit={onAdd}>
        <div className="field">
          <label htmlFor="mem-kind">Type</label>
          <select
            id="mem-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as MemoryKind)}
          >
            {MEMORY_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mem-text">What to remember</label>
          <textarea
            id="mem-text"
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mem-topic">Topic (optional: items on the same topic are checked for conflicts)</label>
          <input
            id="mem-topic"
            type="text"
            maxLength={100}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
        </div>
        <button type="submit" disabled={text.trim() === ''}>
          Add
        </button>
      </form>

      {disputedCount > 0 ? (
        <p className="banner small-text">
          {disputedCount} item{disputedCount === 1 ? '' : 's'} disputed: information conflicts. Choose
          &quot;Keep this one&quot; on the item that is right.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="mem-filter">Show</label>
        <select
          id="mem-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {items === null ? <p className="muted">Loading…</p> : null}
      {items !== null && visible.length === 0 ? <p className="muted">Nothing to show here.</p> : null}

      <ul className="projects">
        {visible.map((item) => (
          <MemoryRow
            key={item.id}
            item={item}
            items={items ?? []}
            run={run}
            linkTarget={linkTarget}
            onLinkTarget={onLinkTarget}
          />
        ))}
      </ul>

      <div className="row gap">
        <button type="button" className="small secondary" onClick={() => onExport('md')}>
          Download Markdown
        </button>
        <button type="button" className="small secondary" onClick={() => onExport('json')}>
          Download JSON
        </button>
        {confirmClear ? (
          <>
            <button
              type="button"
              className="small danger"
              onClick={() =>
                void run(() => memoryRepo.removeAllForProject(projectId), 'All memory deleted.').then(
                  () => setConfirmClear(false),
                )
              }
            >
              Confirm: delete ALL memory for this project
            </button>
            <button type="button" className="small secondary" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="small secondary" onClick={() => setConfirmClear(true)}>
            Delete all memory
          </button>
        )}
      </div>

      {notice ? <p className="ok">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}