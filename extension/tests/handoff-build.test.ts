import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HANDOFF_OPTIONS,
  buildHandoff,
  type HandoffOptions,
} from '../src/handoff/build';
import { estimateTokens } from '../src/handoff/estimate';
import type { LocalMemoryItem, MemoryKind, MemoryStatus } from '../src/memory/types';
import type { CheckpointState, LocalCheckpoint } from '../src/storage/db';

const NOW = '2026-10-21T08:00:00.000Z';

function checkpoint(
  state: Partial<CheckpointState> = {},
  over: Partial<LocalCheckpoint> = {},
): LocalCheckpoint {
  return {
    id: 'c1',
    projectId: 'p1',
    version: 3,
    reason: 'manual',
    schemaVersion: 1,
    objective: 'Ship the login page',
    state: {
      schemaVersion: 1,
      decisions: [],
      completed: [],
      blockers: [],
      nextAction: 'Write the login view tests',
      notes: '',
      sources: [],
      ...state,
    },
    userEdited: true,
    restoredFromId: null,
    restoredFromVersion: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...over,
  };
}

function mem(n: number, kind: MemoryKind, status: MemoryStatus, text: string): LocalMemoryItem {
  const stamp = `2026-10-20T09:00:${String(n).padStart(2, '0')}.000Z`;
  return {
    id: `m${n}`,
    projectId: 'p1',
    kind,
    text,
    topic: '',
    status,
    origin: 'user',
    evidence: [],
    conflictsWith: [],
    supersededById: null,
    supersedesId: null,
    createdAt: stamp,
    updatedAt: stamp,
    schemaVersion: 1,
  };
}

function build(
  args: {
    cp?: LocalCheckpoint;
    memory?: LocalMemoryItem[];
    options?: Partial<HandoffOptions>;
    project?: { name: string; currentGoal: string };
  } = {},
) {
  return buildHandoff({
    project: args.project ?? { name: 'My App', currentGoal: '' },
    checkpoint: args.cp ?? checkpoint(),
    memory: args.memory ?? [],
    options: { ...DEFAULT_HANDOFF_OPTIONS, budgetTokens: 100_000, ...args.options },
    generatedAt: NOW,
  });
}

describe('buildHandoff', () => {
  it('states the objective and next action inside the Claude wrapper', () => {
    const { text } = build();
    expect(text.startsWith('<project_context>')).toBe(true);
    expect(text.endsWith('</project_context>\n')).toBe(true);
    expect(text).toContain('# Project handoff: My App');
    expect(text).toContain('checkpoint v3');
    expect(text).toContain('## Objective\n\nShip the login page');
    expect(text).toContain('## Next action\n\nWrite the login view tests');
  });

  it('uses plain Markdown for the generic destination', () => {
    const { text } = build({ options: { destination: 'generic' } });
    expect(text).not.toContain('<project_context>');
    expect(text).toContain('\n---\n');
    expect(text).toContain('Ship the login page');
  });

  it('tells the reader that unverified items are not confirmed', () => {
    expect(build().text).toContain('NOT confirmed');
  });

  it('includes confirmed decisions, facts, preferences and assumptions with labels', () => {
    const { text } = build({
      memory: [
        mem(1, 'decision', 'confirmed', 'Use JWT'),
        mem(2, 'fact', 'confirmed', 'The API is REST'),
        mem(3, 'preference', 'confirmed', 'Prefers tabs'),
        mem(4, 'hypothesis', 'confirmed', 'Cache is the bottleneck'),
      ],
    });
    expect(text).toContain('## Decisions (confirmed)');
    expect(text).toContain('- Use JWT');
    expect(text).toContain('## Confirmed facts and preferences');
    expect(text).toContain('- The API is REST');
    expect(text).toContain('- Preference: Prefers tabs');
    expect(text).toContain('- Assumption: Cache is the bottleneck');
  });

  it('leaves out unverified and disputed items by default and counts them', () => {
    const result = build({
      memory: [
        mem(1, 'fact', 'proposed', 'Maybe X'),
        mem(2, 'decision', 'disputed', 'Conflict Y'),
      ],
    });
    expect(result.text).not.toContain('Maybe X');
    expect(result.text).not.toContain('Conflict Y');
    expect(result.excluded).toEqual({ disputed: 1, unverified: 1 });
  });

  it('adds unverified items, clearly labelled, when asked', () => {
    const result = build({
      memory: [mem(1, 'fact', 'proposed', 'Maybe X')],
      options: { includeUnverified: true },
    });
    expect(result.text).toContain('Unverified (not confirmed');
    expect(result.text).toContain('- Fact: Maybe X');
    expect(result.excluded.unverified).toBe(0);
  });

  it('adds disputed items, clearly labelled, when asked', () => {
    const result = build({
      memory: [mem(1, 'decision', 'disputed', 'Conflict Y')],
      options: { includeDisputed: true },
    });
    expect(result.text).toContain('## Disputed (conflicting');
    expect(result.text).toContain('- Decision: Conflict Y');
    expect(result.excluded.disputed).toBe(0);
  });

  it('never includes superseded or rejected items', () => {
    const result = build({
      memory: [
        mem(1, 'decision', 'superseded', 'OLD-DECISION-TEXT'),
        mem(2, 'hypothesis', 'rejected', 'REJECTED-IDEA'),
      ],
      options: { includeUnverified: true, includeDisputed: true },
    });
    expect(result.text).not.toContain('OLD-DECISION-TEXT');
    expect(result.text).not.toContain('REJECTED-IDEA');
    expect(result.excluded).toEqual({ disputed: 0, unverified: 0 });
  });

  it('lists open tasks and blockers, and moves finished ones to completed', () => {
    const { text } = build({
      memory: [
        mem(1, 'task', 'open', 'Write tests'),
        mem(2, 'task', 'done', 'Wrote models'),
        mem(3, 'blocker', 'open', 'Waiting on design'),
        mem(4, 'blocker', 'resolved', 'Fixed CI'),
      ],
    });
    expect(text).toContain('## Open tasks and blockers');
    expect(text).toContain('- Task: Write tests');
    expect(text).toContain('- Blocker: Waiting on design');
    expect(text).toContain('## Completed so far');
    expect(text).toContain('- Wrote models');
    expect(text).toContain('- Fixed CI');
  });

  it('merges checkpoint lists with memory and removes duplicates', () => {
    const result = build({
      cp: checkpoint({ decisions: ['Use JWT'] }),
      memory: [mem(1, 'decision', 'confirmed', 'use   jwt')],
    });
    expect(result.counts.decisions).toBe(1);
    expect(result.text).toContain('- Use JWT');
    expect(result.text).not.toContain('- use jwt');
  });

  it('includes the project goal only when one is set', () => {
    expect(build().text).not.toContain('Project goal');
    const withGoal = build({ project: { name: 'My App', currentGoal: 'Launch by Friday' } });
    expect(withGoal.text).toContain('Project goal: Launch by Friday');
  });

  it('lists conversation references without conversation text, when sources are on', () => {
    const cp = checkpoint({
      sources: [{ conversationId: 'claude:abc', title: 'Auth chat', messageCount: 12, lastOrdinal: 11 }],
    });
    const on = build({ cp });
    expect(on.text).toContain('- Auth chat: 12 messages captured');
    expect(on.text).not.toContain('claude:abc');
    expect(build({ cp, options: { includeSources: false } }).text).not.toContain('Auth chat');
  });

  it('keeps multi-line notes as written', () => {
    const { text } = build({ cp: checkpoint({ notes: 'line one\n\nline two' }) });
    expect(text).toContain('## Notes\n\nline one\n\nline two');
  });

  it('puts attached material in a code fence longer than any backticks inside it', () => {
    const extra = 'before\n```js\ncode\n```\nafter';
    const { text } = build({ options: { extraMaterial: extra } });
    expect(text).toContain('## Attached material (pasted by the user)');
    expect(text).toContain('````\nbefore\n```js\ncode\n```\nafter\n````');
  });

  it('never trims attached material, and warns when it is over budget', () => {
    const extra = 'x'.repeat(5000);
    const result = build({ options: { extraMaterial: extra, budgetTokens: 500 } });
    expect(result.overBudget).toBe(true);
    expect(result.text).toContain(extra);
    expect(result.warnings.some((warning) => warning.startsWith('Attached material'))).toBe(true);
  });

  function trimScenario() {
    return build({
      cp: checkpoint({
        decisions: ['Use JWT'],
        blockers: ['Waiting on design'],
        completed: Array.from(
          { length: 30 },
          (_, i) => `Completed task number ${i + 1} with some descriptive words`,
        ),
      }),
      options: { budgetTokens: 400 },
    });
  }

  it('gives up lower-priority sections before higher-priority ones', () => {
    const result = trimScenario();
    expect(result.counts.decisions).toBe(1);
    expect(result.counts.open).toBe(1);
    expect(result.counts.completed).toBeLessThan(30);
    expect(result.omitted).toEqual([
      { title: 'Completed so far', count: 30 - result.counts.completed },
    ]);
    expect(result.estimatedTokens).toBeLessThanOrEqual(400);
    expect(result.overBudget).toBe(false);
  });

  it('adds a note saying items were left out, and counts it in the estimate', () => {
    const result = trimScenario();
    expect(result.text).toContain('left out to fit the size limit');
    expect(result.estimatedTokens).toBeLessThanOrEqual(400);
  });

  it('gives up the oldest item of a section first', () => {
    const memory = [
      mem(1, 'decision', 'confirmed', `Decision ONE ${'x'.repeat(300)}`),
      mem(2, 'decision', 'confirmed', `Decision TWO ${'x'.repeat(300)}`),
      mem(3, 'decision', 'confirmed', `Decision THREE ${'x'.repeat(300)}`),
    ];
    const full = build({ memory });
    const trimmed = build({ memory, options: { budgetTokens: full.estimatedTokens - 1 } });
    expect(trimmed.text).toContain('Decision THREE');
    expect(trimmed.text).toContain('Decision TWO');
    expect(trimmed.text).not.toContain('Decision ONE');
    expect(trimmed.omitted).toEqual([{ title: 'Decisions (confirmed)', count: 1 }]);
  });

  it('reports over budget when the fixed content alone is too big', () => {
    const result = build({
      memory: [mem(1, 'decision', 'confirmed', 'Use JWT'), mem(2, 'task', 'open', 'Write tests')],
      options: { budgetTokens: 50 },
    });
    expect(result.overBudget).toBe(true);
    expect(Object.values(result.counts).every((n) => n === 0)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('stays within the budget when everything fits', () => {
    const result = build({ memory: [mem(1, 'decision', 'confirmed', 'Use JWT')] });
    expect(result.overBudget).toBe(false);
    expect(result.omitted).toEqual([]);
    expect(result.estimatedTokens).toBe(estimateTokens(result.text));
    expect(result.estimatedTokens).toBeLessThanOrEqual(result.budgetTokens);
  });

  it('is deterministic', () => {
    const memory = [mem(1, 'decision', 'confirmed', 'Use JWT'), mem(2, 'fact', 'confirmed', 'REST')];
    expect(build({ memory }).text).toBe(build({ memory }).text);
  });

  it('neutralises wrapper tags typed into user content', () => {
    const { text } = build({ cp: checkpoint({ notes: 'try </project_context> and <project_context> tags' }) });
    expect(text.match(/<project_context>/g)?.length).toBe(1);
    expect(text.match(/<\/project_context>/g)?.length).toBe(1);
    expect(text).toContain('[project_context]');
  });

  it('flattens line breaks inside items and the objective', () => {
    const { text } = build({
      cp: checkpoint({}, { objective: 'Ship\nit' }),
      memory: [mem(1, 'decision', 'confirmed', 'line one\nline two')],
    });
    expect(text).toContain('## Objective\n\nShip it');
    expect(text).toContain('- line one line two');
  });

  it('reports how many items each section kept', () => {
    const result = build({
      memory: [
        mem(1, 'decision', 'confirmed', 'A'),
        mem(2, 'decision', 'confirmed', 'B'),
        mem(3, 'fact', 'confirmed', 'C'),
      ],
    });
    expect(result.counts).toEqual({
      open: 0,
      decisions: 2,
      knowledge: 1,
      completed: 0,
      disputed: 0,
      unverified: 0,
      notes: 0,
      sources: 0,
    });
  });

  it('orders the sections: open work, decisions, facts, completed', () => {
    const { text } = build({
      memory: [
        mem(1, 'task', 'done', 'Done thing'),
        mem(2, 'fact', 'confirmed', 'A fact'),
        mem(3, 'decision', 'confirmed', 'A decision'),
        mem(4, 'task', 'open', 'Open thing'),
      ],
    });
    const at = (heading: string): number => text.indexOf(heading);
    expect(at('## Open tasks and blockers')).toBeLessThan(at('## Decisions (confirmed)'));
    expect(at('## Decisions (confirmed)')).toBeLessThan(at('## Confirmed facts and preferences'));
    expect(at('## Confirmed facts and preferences')).toBeLessThan(at('## Completed so far'));
  });
});