import { useEffect, useState } from 'react';
import {
  DEFAULT_HANDOFF_OPTIONS,
  buildHandoff,
  type HandoffOptions,
  type HandoffResult,
} from '../../../src/handoff/build';
import {
  DESTINATIONS,
  DESTINATION_IDS,
  type DestinationId,
} from '../../../src/handoff/destinations';
import { estimateTokens } from '../../../src/handoff/estimate';
import type { LocalProject } from '../../../src/storage/db';
import { INSERT_ERROR_TEXT } from '../../../src/handoff/insert-message';
import { insertIntoActiveClaudeTab } from '../insert-into-tab';
import { downloadText } from '../download';
import { useCheckpoints } from '../hooks';
import { useMemoryItems } from '../memory-hooks';

interface Props {
  projectId: string | null;
  project: LocalProject | undefined;
}

interface Draft {
  text: string;
  result: HandoffResult;
  signature: string;
}

const fmt = (n: number): string => n.toLocaleString();

export function HandoffCard({ projectId, project }: Props) {
  const { checkpoints } = useCheckpoints(projectId);
  const memory = useMemoryItems(projectId);
  const [options, setOptions] = useState<HandoffOptions>(DEFAULT_HANDOFF_OPTIONS);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);

  // A different project starts from a clean slate.
  useEffect(() => {
    setDraft(null);
    setPickedId(null);
    setEdited(false);
    setNotice(null);
    setError(null);
  }, [projectId]);

  if (!projectId) {
    return (
      <section className="card">
        <h2>Handoff package</h2>
        <p className="muted">Select or create a project above to build a handoff package.</p>
      </section>
    );
  }

  const selected = checkpoints?.find((checkpoint) => checkpoint.id === pickedId) ?? checkpoints?.[0];
  const signature = JSON.stringify([
    selected?.id ?? null,
    options,
    (memory ?? []).map((item) => `${item.id}:${item.updatedAt}`),
  ]);
  const stale = draft !== null && draft.signature !== signature;
  const patch = (change: Partial<HandoffOptions>): void =>
    setOptions((current) => ({ ...current, ...change }));

  const onGenerate = (): void => {
    if (!selected || !project) return;
    setError(null);
    setNotice(null);
    try {
      const result = buildHandoff({
        project,
        checkpoint: selected,
        memory: memory ?? [],
        options,
        generatedAt: new Date().toISOString(),
      });
      setDraft({ text: result.text, result, signature });
      setEdited(false);
    } catch (e) {
      console.error('Continuity: could not build handoff', e instanceof Error ? e.name : 'Error');
      setError('Could not build the package.');
    }
  };

  const onCopy = (): void => {
    if (!draft) return;
    setError(null);
    navigator.clipboard.writeText(draft.text).then(
      () => setNotice('Copied. Paste it into a new chat.'),
      () => setError('Could not copy. Use Download instead.'),
    );
  };

  const onDownload = (): void => {
    if (!draft || !selected) return;
    const base = (project?.name ?? 'project').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'project';
    downloadText(`${base}-handoff-v${selected.version}.md`, draft.text, 'text/markdown');
  };

  const onInsert = (): void => {
    if (!draft || inserting) return;
    setInserting(true);
    setError(null);
    setNotice(null);
    void insertIntoActiveClaudeTab(draft.text)
      .then((outcome) => {
        if (outcome.ok) {
          setNotice('Inserted into the message box. Review it, then press Send yourself: nothing was sent.');
        } else {
          setError(INSERT_ERROR_TEXT[outcome.error]);
        }
      })
      .finally(() => setInserting(false));
  };

  const budget = draft?.result.budgetTokens ?? options.budgetTokens;
  const tokens = draft ? estimateTokens(draft.text) : 0;
  const over = tokens > budget;
  const destination = DESTINATIONS[options.destination];

  return (
    <section className="card">
      <h2>Handoff package</h2>
      <p className="muted">
        Builds a compact summary to paste into a new AI chat. Nothing is sent anywhere by this card:
        when you paste the text into a chat, that chat&apos;s provider receives it. Chat messages are
        never included.
      </p>

      {checkpoints === null ? <p className="muted">Loading…</p> : null}
      {checkpoints !== null && checkpoints.length === 0 ? (
        <p className="muted">Save a checkpoint first (Checkpoints card): the package is built from it.</p>
      ) : null}

      {selected ? (
        <>
          <div className="field">
            <label htmlFor="ho-checkpoint">Checkpoint</label>
            <select
              id="ho-checkpoint"
              value={selected.id}
              onChange={(event) => setPickedId(event.target.value)}
            >
              {(checkpoints ?? []).map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  Version {checkpoint.version} · {new Date(checkpoint.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ho-destination">Format</label>
            <select
              id="ho-destination"
              value={options.destination}
              onChange={(event) => {
                const id = event.target.value as DestinationId;
                patch({ destination: id, budgetTokens: DESTINATIONS[id].defaultBudget });
              }}
            >
              {DESTINATION_IDS.map((id) => (
                <option key={id} value={id}>
                  {DESTINATIONS[id].name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ho-budget">Size limit for the package (rough estimate, in tokens)</label>
            <select
              id="ho-budget"
              value={options.budgetTokens}
              onChange={(event) => patch({ budgetTokens: Number(event.target.value) })}
            >
              {destination.budgetOptions.map((value) => (
                <option key={value} value={value}>
                  {fmt(value)}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeUnverified}
              onChange={(event) => patch({ includeUnverified: event.target.checked })}
            />
            Include unverified items (labelled as not confirmed)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeDisputed}
              onChange={(event) => patch({ includeDisputed: event.target.checked })}
            />
            Include disputed items (labelled as conflicting)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeSources}
              onChange={(event) => patch({ includeSources: event.target.checked })}
            />
            List conversation titles and message counts
          </label>
          <div className="field">
            <label htmlFor="ho-extra">Attach material (optional: paste code or file contents; included as written)</label>
            <textarea
              id="ho-extra"
              rows={4}
              value={options.extraMaterial}
              onChange={(event) => patch({ extraMaterial: event.target.value })}
            />
          </div>

          <button type="button" onClick={onGenerate}>
            {draft ? (edited ? 'Regenerate (discards your edits)' : 'Regenerate') : 'Generate package'}
          </button>
        </>
      ) : null}

      {draft ? (
        <>
          {stale ? (
            <p className="banner small-text">
              Your choices changed since this was generated. Regenerate to update it (this replaces
              any edits).
            </p>
          ) : null}
          <p className={over ? 'error' : 'muted'}>
            About {fmt(tokens)} tokens (rough estimate) of {fmt(budget)}.{' '}
            {over ? 'Over the limit.' : 'Within the limit.'}
          </p>
          {draft.result.omitted.length > 0 ? (
            <p className="muted small-text">
              Left out to fit:{' '}
              {draft.result.omitted.map((o) => `${o.count} from "${o.title}"`).join(', ')}.
            </p>
          ) : null}
          {draft.result.excluded.disputed > 0 ? (
            <p className="banner small-text">
              {draft.result.excluded.disputed} disputed item(s) not included. Resolve them in Project
              memory, or tick &quot;Include disputed items&quot;.
            </p>
          ) : null}
          {draft.result.excluded.unverified > 0 ? (
            <p className="muted small-text">
              {draft.result.excluded.unverified} unverified item(s) not included.
            </p>
          ) : null}
          {draft.result.warnings.map((warning) => (
            <p key={warning} className="error">
              {warning}
            </p>
          ))}

          <div className="field">
            <label htmlFor="ho-draft">Review and edit before using</label>
            <textarea
              id="ho-draft"
              className="draft"
              rows={14}
              value={draft.text}
              onChange={(event) => {
                setDraft({ ...draft, text: event.target.value });
                setEdited(true);
              }}
            />
          </div>
          <div className="row gap">
            <button type="button" onClick={onCopy}>
              Copy
            </button>
            <button type="button" onClick={onInsert} disabled={inserting}>
              Insert into new Claude chat
            </button>
            <button type="button" className="secondary" onClick={onDownload}>
              Download .md
            </button>
          </div>
          <p className="muted small-text">
            &quot;Insert&quot; fills the message box of the empty new Claude chat in your current tab
            and never presses Send. Once the text is in the box, that page can read it, just as it
            can anything you type there. Check the text for anything you would not want the
            destination to see.
          </p>
        </>
      ) : null}

      {notice ? <p className="ok">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}