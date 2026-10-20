import { describe, expect, it } from 'vitest';
import { renderCheckpointMarkdown } from '../src/checkpoints/markdown';
import type { LocalCheckpoint } from '../src/storage/db';

const project = { name: 'My App' };

function make(overrides: Partial<LocalCheckpoint> = {}): LocalCheckpoint {
  return {
    id: 'c1',
    projectId: 'p1',
    version: 3,
    reason: 'manual',
    schemaVersion: 1,
    objective: 'Ship the login page',
    state: {
      schemaVersion: 1,
      decisions: ['Use JWT'],
      completed: ['Wrote models'],
      blockers: ['Waiting on design'],
      nextAction: 'Write the login view tests',
      notes: 'Remember the throttle.',
      sources: [
        { conversationId: 'claude:abc', title: 'Auth chat', messageCount: 12, lastOrdinal: 11 },
      ],
    },
    userEdited: true,
    restoredFromId: null,
    restoredFromVersion: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('renderCheckpointMarkdown', () => {
  it('renders a complete checkpoint', () => {
    const expected = [
      '# Continuity checkpoint: My App (v3)',
      '',
      '- Saved: 2026-10-20T10:00:00.000Z',
      '- Reason: manual',
      '',
      '## Objective',
      '',
      'Ship the login page',
      '',
      '## Next action',
      '',
      'Write the login view tests',
      '',
      '## Decisions',
      '',
      '- Use JWT',
      '',
      '## Completed',
      '',
      '- Wrote models',
      '',
      '## Blockers',
      '',
      '- Waiting on design',
      '',
      '## Notes',
      '',
      'Remember the throttle.',
      '',
      '## Sources (local conversations)',
      '',
      '_References only; no conversation text is included._',
      '',
      '- Auth chat: 12 messages captured, through message #12',
      '',
    ].join('\n');
    expect(renderCheckpointMarkdown(project, make())).toBe(expected);
  });

  it('omits empty sections', () => {
    const base = make();
    const markdown = renderCheckpointMarkdown(
      project,
      make({
        state: { ...base.state, decisions: [], completed: [], blockers: [], notes: '', sources: [] },
      }),
    );
    for (const heading of ['## Decisions', '## Completed', '## Blockers', '## Notes', '## Sources']) {
      expect(markdown).not.toContain(heading);
    }
    expect(markdown).toContain('## Objective');
    expect(markdown).toContain('## Next action');
  });

  it('shows which version a recovery checkpoint was restored from', () => {
    const markdown = renderCheckpointMarkdown(
      project,
      make({ reason: 'recovery', restoredFromId: 'c0', restoredFromVersion: 1 }),
    );
    expect(markdown).toContain('- Reason: recovery');
    expect(markdown).toContain('- Restored from version 1');
  });

  it('uses the singular for one message and omits the position when none was captured', () => {
    const base = make();
    const markdown = renderCheckpointMarkdown(
      project,
      make({
        state: {
          ...base.state,
          sources: [
            { conversationId: 'claude:a', title: 'Solo', messageCount: 1, lastOrdinal: 0 },
            { conversationId: 'claude:b', title: 'Empty', messageCount: 0, lastOrdinal: null },
          ],
        },
      }),
    );
    expect(markdown).toContain('- Solo: 1 message captured, through message #1\n');
    expect(markdown).toContain('- Empty: 0 messages captured\n');
  });

  it('flattens line breaks in project names and titles', () => {
    const base = make();
    const markdown = renderCheckpointMarkdown(
      { name: 'My\nApp' },
      make({
        state: {
          ...base.state,
          sources: [
            { conversationId: 'claude:a', title: 'Line one\nline two', messageCount: 2, lastOrdinal: 1 },
          ],
        },
      }),
    );
    expect(markdown).toContain('# Continuity checkpoint: My App (v3)');
    expect(markdown).toContain('- Line one line two: 2 messages captured');
  });

  it('labels an untitled conversation', () => {
    const base = make();
    const markdown = renderCheckpointMarkdown(
      project,
      make({
        state: {
          ...base.state,
          sources: [{ conversationId: 'claude:a', title: '', messageCount: 2, lastOrdinal: 1 }],
        },
      }),
    );
    expect(markdown).toContain('- (untitled): 2 messages captured');
  });

  it('keeps multi-line notes as written', () => {
    const base = make();
    const markdown = renderCheckpointMarkdown(
      project,
      make({ state: { ...base.state, notes: 'line one\n\nline two' } }),
    );
    expect(markdown).toContain('## Notes\n\nline one\n\nline two\n');
  });

  it('is deterministic', () => {
    expect(renderCheckpointMarkdown(project, make())).toBe(renderCheckpointMarkdown(project, make()));
  });
});