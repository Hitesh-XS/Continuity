import type { LocalProject } from '../storage/db';
import type { LocalMemoryItem, MemoryHistoryEntry } from './types';

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const byCreated = (a: LocalMemoryItem, b: LocalMemoryItem): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

const SECTIONS: { title: string; match: (item: LocalMemoryItem) => boolean }[] = [
  { title: 'Confirmed', match: (item) => item.status === 'confirmed' },
  { title: 'Open tasks and blockers', match: (item) => item.status === 'open' },
  { title: 'Completed', match: (item) => item.status === 'done' || item.status === 'resolved' },
  { title: 'Unverified (proposed)', match: (item) => item.status === 'proposed' },
  { title: 'Disputed (conflicting information)', match: (item) => item.status === 'disputed' },
  {
    title: 'Superseded or rejected',
    match: (item) => item.status === 'superseded' || item.status === 'rejected',
  },
];

function line(item: LocalMemoryItem): string {
  const topic = item.topic ? ` _(topic: ${oneLine(item.topic)})_` : '';
  const count = item.evidence.length;
  const evidence = count > 0 ? ` · ${count} linked message${count === 1 ? '' : 's'}` : '';
  const tag = item.status === 'superseded' || item.status === 'rejected' ? ` [${item.status}]` : '';
  return `- **${item.kind}** ${oneLine(item.text)}${topic}${evidence}${tag}`;
}

/**
 * Readable Markdown of a project's memory. Pure and deterministic.
 * Linked messages are COUNTED, never quoted: no conversation text is included.
 */
export function renderMemoryMarkdown(
  project: Pick<LocalProject, 'name'>,
  items: LocalMemoryItem[],
  options: { exportedAt: string },
): string {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const sorted = [...items].sort(byCreated);
  const out: string[] = [
    `# Project memory: ${oneLine(project.name)}`,
    '',
    `- Exported: ${options.exportedAt}`,
    `- Items: ${items.length}`,
    '',
    '_Only items under "Confirmed" are verified. Everything else is open, unverified, disputed or historical. Linked messages are counted, not quoted: no conversation text is included._',
    '',
  ];
  if (items.length === 0) {
    out.push('No memory items.', '');
    return `${out.join('\n').trimEnd()}\n`;
  }
  for (const section of SECTIONS) {
    const members = sorted.filter(section.match);
    if (members.length === 0) continue;
    out.push(`## ${section.title}`, '');
    for (const member of members) {
      out.push(line(member));
      if (member.status === 'superseded' && member.supersededById) {
        const replacement = byId.get(member.supersededById);
        if (replacement) out.push(`  - Replaced by: ${oneLine(replacement.text)}`);
      }
      if (member.status === 'disputed') {
        for (const id of member.conflictsWith) {
          const partner = byId.get(id);
          if (partner) out.push(`  - Conflicts with: ${oneLine(partner.text)}`);
        }
      }
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** A complete, re-readable export: items, evidence references and edit history. */
export function exportMemoryJson(
  project: Pick<LocalProject, 'id' | 'name'>,
  items: LocalMemoryItem[],
  history: MemoryHistoryEntry[],
  exportedAt: string,
): string {
  return JSON.stringify(
    {
      format: 'continuity-memory',
      version: 1,
      exportedAt,
      project: { id: project.id, name: project.name },
      items: [...items].sort(byCreated),
      history,
    },
    null,
    2,
  );
}