// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cleanClaudeTitle,
  domFingerprint,
  extractClaudeSnapshot,
  maxRowIndex,
} from '../src/capture/adapters/claude';
import { MAX_MESSAGE_CHARS, SnapshotSchema } from '../src/capture/snapshot';
import { CHAT_URL, CLAUDE_TRANSCRIPT_HTML, CONVERSATION_ID } from './fixtures/claude-transcript';

const input = { url: CHAT_URL, title: 'Add function - Claude' };

function row(index: number): Element {
  const element = document.querySelector(`[data-testid="transcript-row"][data-index="${index}"]`);
  if (!element) throw new Error(`no row ${index}`);
  return element;
}

function snapshotOf(overrides: Parameters<typeof extractClaudeSnapshot>[1] = input) {
  const outcome = extractClaudeSnapshot(document, overrides);
  if (outcome.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${outcome.kind}`);
  return outcome;
}

beforeEach(() => {
  document.body.innerHTML = CLAUDE_TRANSCRIPT_HTML;
});

describe('extractClaudeSnapshot', () => {
  it('extracts the messages in order with roles and page indexes', () => {
    const { snapshot } = snapshotOf();
    expect(snapshot.messages.map((m) => [m.index, m.role])).toEqual([
      [0, 'user'],
      [1, 'assistant'],
      [2, 'user'],
      [3, 'assistant'],
    ]);
  });

  it('reads user text exactly', () => {
    expect(snapshotOf().snapshot.messages[0]?.text).toBe('Write an add function');
  });

  it('reads an assistant code block and paragraph', () => {
    expect(snapshotOf().snapshot.messages[1]?.text).toBe(
      '```python\ndef add(a, b):\n    return a + b\n```\n\nSimple and direct.',
    );
  });

  it('reads an assistant list with inline code', () => {
    expect(snapshotOf().snapshot.messages[3]?.text).toBe(
      'Two quick tips:\n\n- **Name things:** use `snake_case` names.\n- **Add tests:** cover `add(0, 0)`.',
    );
  });

  it('leaves out interface chrome', () => {
    const all = snapshotOf()
      .snapshot.messages.map((m) => m.text)
      .join('\n');
    for (const chrome of ['You said', 'Claude responded', 'Retry', '9:21', 'Copy']) {
      expect(all).not.toContain(chrome);
    }
  });

  it('takes the conversation id from the URL and a cleaned title', () => {
    const { snapshot } = snapshotOf();
    expect(snapshot.externalConversationId).toBe(CONVERSATION_ID);
    expect(snapshot.title).toBe('Add function');
  });

  it('omits the title when the page title is only the product name', () => {
    expect(snapshotOf({ url: CHAT_URL, title: 'Claude' }).snapshot.title).toBeUndefined();
  });

  it('skips rows that are still streaming and reports it', () => {
    row(3).setAttribute('data-perf-row-streaming', 'true');
    const outcome = snapshotOf();
    expect(outcome.streaming).toBe(true);
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it('detects streaming from the assistant message flag alone', () => {
    row(3).querySelector('[data-testid="assistant-message"]')?.setAttribute('data-is-streaming', 'true');
    const outcome = snapshotOf();
    expect(outcome.streaming).toBe(true);
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it('keeps absolute indexes when the page renders only a window of rows', () => {
    row(0).remove();
    row(1).remove();
    expect(snapshotOf().snapshot.messages.map((m) => m.index)).toEqual([2, 3]);
  });

  it('counts rows with an unrecognised role and does not capture them', () => {
    row(1).setAttribute('data-perf-row', 'system');
    const outcome = snapshotOf();
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([0, 2, 3]);
    expect(outcome.health.unrecognized).toBe(1);
  });

  it('skips rows without a usable index', () => {
    const target = row(1);
    target.removeAttribute('data-index');
    target.removeAttribute('data-rs-index');
    const outcome = snapshotOf();
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([0, 2, 3]);
    expect(outcome.health.unrecognized).toBe(1);
  });

  it('counts assistant rows without reply text as unrecognised', () => {
    row(3).querySelector('[data-perf-reply-text]')?.remove();
    const outcome = snapshotOf();
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(outcome.health.unrecognized).toBe(1);
  });

  it('ignores a duplicate row index', () => {
    const duplicate = row(2);
    duplicate.setAttribute('data-index', '0');
    duplicate.setAttribute('data-rs-index', '0');
    const outcome = snapshotOf();
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([0, 1, 3]);
    expect(outcome.health.unrecognized).toBe(1);
  });

  it('truncates an over-long message to the limit', () => {
    const paragraph = row(0).querySelector('p');
    if (!paragraph) throw new Error('no paragraph');
    paragraph.textContent = 'x'.repeat(MAX_MESSAGE_CHARS + 50);
    expect(snapshotOf().snapshot.messages[0]?.text.length).toBe(MAX_MESSAGE_CHARS);
  });

  it('skips rows at or below the baseline index', () => {
    const outcome = snapshotOf({ ...input, skipUpToIndex: 2 });
    expect(outcome.snapshot.messages.map((m) => m.index)).toEqual([3]);
  });

  it('reports no_conversation off a conversation page', () => {
    const outcome = extractClaudeSnapshot(document, { url: 'https://claude.ai/new', title: '' });
    expect(outcome.kind).toBe('no_conversation');
  });

  it('reports no_transcript when the feed is missing', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(extractClaudeSnapshot(document, input).kind).toBe('no_transcript');
  });

  it('reports degraded when rows exist but none can be read', () => {
    document
      .querySelectorAll('[data-testid="transcript-row"]')
      .forEach((element) => element.setAttribute('data-perf-row', 'system'));
    const outcome = extractClaudeSnapshot(document, input);
    expect(outcome.kind).toBe('empty');
    expect(outcome.health.state).toBe('degraded');
  });

  it('produces a snapshot that passes validation', () => {
    expect(SnapshotSchema.safeParse(snapshotOf().snapshot).success).toBe(true);
  });
});

describe('cleanClaudeTitle', () => {
  it.each<[string, string]>([
    ['Add function - Claude', 'Add function'],
    ['Add function | Claude', 'Add function'],
    ['Claude', ''],
    ['', ''],
    ['  Some – Claude  ', 'Some'],
  ])('cleans %j to %j', (raw, expected) => {
    expect(cleanClaudeTitle(raw)).toBe(expected);
  });
});

describe('page helpers', () => {
  it('finds the highest row index', () => {
    expect(maxRowIndex(document)).toBe(3);
  });

  it('returns undefined when there are no rows', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(maxRowIndex(document)).toBeUndefined();
  });

  it('changes the fingerprint when content changes', () => {
    const before = domFingerprint(document);
    const paragraph = row(0).querySelector('p');
    if (!paragraph) throw new Error('no paragraph');
    paragraph.textContent = 'A completely different first message';
    expect(domFingerprint(document)).not.toBe(before);
  });
});

describe('extractClaudeSnapshot: diagnostics', () => {
  it('counts a row without a reply container as noTextContainer', () => {
    row(3).querySelector('[data-perf-reply-text]')?.remove();
    expect(snapshotOf().health.detail).toMatchObject({ noTextContainer: 1, emptyText: 0 });
  });

  it('counts an empty reply container as emptyText with no raw characters', () => {
    const container = row(3).querySelector('[data-perf-reply-text]');
    if (container) container.innerHTML = '';
    expect(snapshotOf().health.detail).toMatchObject({ emptyText: 1, emptyTextRawChars: 0 });
  });

  it('flags text that exists on the page but could not be converted', () => {
    const container = row(3).querySelector('[data-perf-reply-text]');
    if (container) container.innerHTML = '<span aria-hidden="true">hidden words</span>';
    expect(snapshotOf().health.detail).toMatchObject({ emptyText: 1, emptyTextRawChars: 12 });
  });
});