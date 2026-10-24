import { normalizeText } from '../memory/rules';
import type { LocalMemoryItem, MemoryKind } from '../memory/types';
import type { LocalCheckpoint, LocalProject } from '../storage/db';
import type { DestinationId } from './destinations';
import { estimateTokens } from './estimate';

export type SectionId =
  | 'open'
  | 'decisions'
  | 'knowledge'
  | 'completed'
  | 'disputed'
  | 'unverified'
  | 'notes'
  | 'sources';

const TITLES: Record<SectionId, string> = {
  open: 'Open tasks and blockers',
  decisions: 'Decisions (confirmed)',
  knowledge: 'Confirmed facts and preferences',
  completed: 'Completed so far',
  disputed: 'Disputed (conflicting information, not settled)',
  unverified: 'Unverified (not confirmed, treat with caution)',
  notes: 'Notes',
  sources: 'Where this came from (conversation references)',
};

/** The order sections appear in the package. */
const DISPLAY_ORDER: readonly SectionId[] = [
  'open',
  'decisions',
  'knowledge',
  'completed',
  'disputed',
  'unverified',
  'notes',
  'sources',
];

/** The order items are given up when the package is over budget: first entry goes first. */
const DROP_ORDER: readonly SectionId[] = [
  'sources',
  'unverified',
  'disputed',
  'notes',
  'completed',
  'knowledge',
  'decisions',
  'open',
];

const PREAMBLE =
  'This is saved context from my earlier work on a project. I assembled it myself from my own notes and checkpoints. ' +
  'Use it as background to continue the work. Anything marked unverified or disputed is NOT confirmed. ' +
  'If it conflicts with what I say in this conversation, follow my current message. ' +
  'First, briefly restate the objective and the next action so I can check you understood, and ask me for anything you need before you start.';

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: 'Fact',
  preference: 'Preference',
  decision: 'Decision',
  hypothesis: 'Assumption',
  task: 'Task',
  blocker: 'Blocker',
};

export interface HandoffOptions {
  destination: DestinationId;
  budgetTokens: number;
  includeUnverified: boolean;
  includeDisputed: boolean;
  includeSources: boolean;
  /** Text the user pasted (code, a file, anything). Included exactly as given, never trimmed. */
  extraMaterial: string;
}

export const DEFAULT_HANDOFF_OPTIONS: HandoffOptions = {
  destination: 'claude',
  budgetTokens: 8000,
  includeUnverified: false,
  includeDisputed: false,
  includeSources: true,
  extraMaterial: '',
};

export interface HandoffInput {
  project: Pick<LocalProject, 'name' | 'currentGoal'>;
  checkpoint: LocalCheckpoint;
  memory: LocalMemoryItem[];
  options: HandoffOptions;
  generatedAt: string;
}

export interface OmittedSection {
  title: string;
  count: number;
}

export interface HandoffResult {
  text: string;
  estimatedTokens: number;
  budgetTokens: number;
  overBudget: boolean;
  /** Items left out to fit the budget. */
  omitted: OmittedSection[];
  /** Items per section in the final package. */
  counts: Record<SectionId, number>;
  /** Items deliberately left out because of the options (not because of size). */
  excluded: { disputed: number; unverified: number };
  warnings: string[];
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const newestFirst = (a: LocalMemoryItem, b: LocalMemoryItem): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1;

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = normalizeText(item);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function collect(input: HandoffInput): Record<SectionId, string[]> {
  const { checkpoint, memory, options } = input;
  const state = checkpoint.state;
  const items = [...memory].sort(newestFirst); // newest first: giving items up from the end drops the oldest
  const text = (item: LocalMemoryItem): string => oneLine(item.text);
  const labelled = (item: LocalMemoryItem): string => `${KIND_LABEL[item.kind]}: ${text(item)}`;

  const knowledge = items
    .filter(
      (item) =>
        item.status === 'confirmed' &&
        (item.kind === 'fact' || item.kind === 'preference' || item.kind === 'hypothesis'),
    )
    .map((item) => (item.kind === 'fact' ? text(item) : labelled(item)));

  return {
    open: dedupe([
      ...items.filter((i) => i.status === 'open' && i.kind === 'task').map(labelled),
      ...state.blockers.map((blocker) => `Blocker: ${oneLine(blocker)}`),
      ...items.filter((i) => i.status === 'open' && i.kind === 'blocker').map(labelled),
    ]),
    decisions: dedupe([
      ...state.decisions.map(oneLine),
      ...items.filter((i) => i.status === 'confirmed' && i.kind === 'decision').map(text),
    ]),
    knowledge: dedupe(knowledge),
    completed: dedupe([
      ...state.completed.map(oneLine),
      ...items.filter((i) => i.status === 'done' || i.status === 'resolved').map(text),
    ]),
    disputed: options.includeDisputed
      ? dedupe(items.filter((i) => i.status === 'disputed').map(labelled))
      : [],
    unverified: options.includeUnverified
      ? dedupe(items.filter((i) => i.status === 'proposed').map(labelled))
      : [],
    notes: state.notes.trim() ? [state.notes.trim()] : [],
    sources: options.includeSources
      ? dedupe(
          state.sources.map((source) => {
            const title = oneLine(source.title) || '(untitled)';
            return `${title}: ${source.messageCount} message${source.messageCount === 1 ? '' : 's'} captured`;
          }),
        )
      : [],
  };
}

function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function renderSection(id: SectionId, items: string[]): string {
  if (id === 'notes') return `## ${TITLES[id]}\n\n${items[0] ?? ''}`;
  return `## ${TITLES[id]}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** Stops text typed by the user from closing or reopening the wrapper. */
function neutralizeDelimiters(text: string): string {
  return text.replace(/<\/?\s*project_context\s*>/gi, '[project_context]');
}

function assemble(
  input: HandoffInput,
  kept: Record<SectionId, string[]>,
  omittedCount: number,
  extra: string,
): string {
  const { project, checkpoint, options, generatedAt } = input;
  const head = [
    `# Project handoff: ${oneLine(project.name)}`,
    '',
    `Prepared ${generatedAt} from checkpoint v${checkpoint.version} (saved ${checkpoint.createdAt}).`,
  ];
  const goal = oneLine(project.currentGoal);
  if (goal) head.push('', `Project goal: ${goal}`);

  const blocks: string[] = [
    head.join('\n'),
    `## Objective\n\n${oneLine(checkpoint.objective)}`,
    `## Next action\n\n${oneLine(checkpoint.state.nextAction)}`,
  ];
  for (const id of DISPLAY_ORDER) {
    const items = kept[id];
    if (items.length > 0) blocks.push(renderSection(id, items));
  }
  if (extra) {
    const fence = fenceFor(extra);
    blocks.push(`## Attached material (pasted by the user)\n\n${fence}\n${extra}\n${fence}`);
  }
  if (omittedCount > 0) {
    blocks.push(
      `_Note: ${omittedCount} lower-priority item${omittedCount === 1 ? '' : 's'} left out to fit the size limit._`,
    );
  }

  const body = neutralizeDelimiters(blocks.join('\n\n'));
  if (options.destination === 'claude') {
    return `<project_context>\n${PREAMBLE}\n\n${body}\n</project_context>\n`;
  }
  return `${PREAMBLE}\n\n---\n\n${body}\n`;
}

/** Pure and deterministic. Builds the package, then gives items up until it fits the budget. */
export function buildHandoff(input: HandoffInput): HandoffResult {
  const { options } = input;
  const extra = options.extraMaterial.replace(/^\s*\n/, '').trimEnd();
  const kept = collect(input);

  const countByStatus = (status: LocalMemoryItem['status']): number =>
    input.memory.filter((item) => item.status === status).length;
  const excluded = {
    disputed: options.includeDisputed ? 0 : countByStatus('disputed'),
    unverified: options.includeUnverified ? 0 : countByStatus('proposed'),
  };

  const dropped = new Map<SectionId, number>();
  let omittedCount = 0;
  let text = assemble(input, kept, omittedCount, extra);
  while (estimateTokens(text) > options.budgetTokens) {
    const target = DROP_ORDER.find((id) => kept[id].length > 0);
    if (!target) break; // nothing optional left to give up
    kept[target] = kept[target].slice(0, -1);
    dropped.set(target, (dropped.get(target) ?? 0) + 1);
    omittedCount += 1;
    text = assemble(input, kept, omittedCount, extra);
  }

  const estimatedTokens = estimateTokens(text);
  const overBudget = estimatedTokens > options.budgetTokens;
  const warnings: string[] = [];
  if (overBudget) {
    warnings.push(
      `Even with every optional item left out, the package is about ${estimatedTokens} tokens, over the ${options.budgetTokens}-token budget. Shorten the objective, notes or attached material, or choose a bigger budget.`,
    );
  }
  const extraTokens = estimateTokens(extra);
  if (extraTokens > options.budgetTokens) {
    warnings.push(
      `Attached material alone is about ${extraTokens} tokens, more than the ${options.budgetTokens}-token budget.`,
    );
  }

  return {
    text,
    estimatedTokens,
    budgetTokens: options.budgetTokens,
    overBudget,
    omitted: DROP_ORDER.filter((id) => (dropped.get(id) ?? 0) > 0).map((id) => ({
      title: TITLES[id],
      count: dropped.get(id) ?? 0,
    })),
    counts: Object.fromEntries(DISPLAY_ORDER.map((id) => [id, kept[id].length])) as Record<
      SectionId,
      number
    >,
    excluded,
    warnings,
  };
}