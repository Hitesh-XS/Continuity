import type { LocalCheckpoint, LocalProject } from '../storage/db';

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

function addList(out: string[], heading: string, items: string[]): void {
  if (items.length === 0) return;
  out.push(`## ${heading}`, '', ...items.map((item) => `- ${oneLine(item)}`), '');
}

/**
 * A readable Markdown rendering of one checkpoint. Pure and deterministic.
 * It contains only what the user wrote plus conversation REFERENCES, never conversation text.
 */
export function renderCheckpointMarkdown(
  project: Pick<LocalProject, 'name'>,
  checkpoint: LocalCheckpoint,
): string {
  const { state } = checkpoint;
  const out: string[] = [
    `# Continuity checkpoint: ${oneLine(project.name)} (v${checkpoint.version})`,
    '',
    `- Saved: ${checkpoint.createdAt}`,
    `- Reason: ${checkpoint.reason}`,
  ];
  if (checkpoint.restoredFromVersion !== null) {
    out.push(`- Restored from version ${checkpoint.restoredFromVersion}`);
  }
  out.push(
    '',
    '## Objective',
    '',
    checkpoint.objective.trim(),
    '',
    '## Next action',
    '',
    state.nextAction.trim(),
    '',
  );
  addList(out, 'Decisions', state.decisions);
  addList(out, 'Completed', state.completed);
  addList(out, 'Blockers', state.blockers);
  if (state.notes.trim()) out.push('## Notes', '', state.notes.trim(), '');

  if (state.sources.length > 0) {
    out.push(
      '## Sources (local conversations)',
      '',
      '_References only; no conversation text is included._',
      '',
    );
    for (const source of state.sources) {
      const title = oneLine(source.title) || '(untitled)';
      const count = `${source.messageCount} message${source.messageCount === 1 ? '' : 's'} captured`;
      const through = source.lastOrdinal === null ? '' : `, through message #${source.lastOrdinal + 1}`;
      out.push(`- ${title}: ${count}${through}`);
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}