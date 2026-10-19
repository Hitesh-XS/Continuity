// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageCapture, type PageCaptureDeps } from '../src/capture/page-capture';
import { CHAT_URL, CLAUDE_TRANSCRIPT_HTML, CONVERSATION_ID } from './fixtures/claude-transcript';

const OTHER_ID = 'ffffffff-1111-4222-8333-444444444444';

type Sent = { type: string; [key: string]: any };

function setup(url: string = CHAT_URL, failFirstSnapshot = false) {
  document.body.innerHTML = CLAUDE_TRANSCRIPT_HTML;
  const state = { url, title: 'Add function - Claude' };
  const sent: Sent[] = [];
  let observed: (() => void) | undefined;
  let failNext = failFirstSnapshot;

  const deps: PageCaptureDeps = {
    root: document,
    getUrl: () => state.url,
    getTitle: () => state.title,
    send: async (message) => {
      const typed = message as Sent;
      sent.push(typed);
      if (typed.type === 'capture.snapshot' && failNext) {
        failNext = false;
        return { ok: false, error: 'internal' };
      }
      return { ok: true };
    },
    observe: (_target, callback) => {
      observed = callback;
      return () => {
        observed = undefined;
      };
    },
    now: () => Date.now(),
  };

  const capture = createPageCapture(deps);
  capture.start();
  return {
    state,
    sent,
    capture,
    trigger: () => observed?.(),
    snapshots: () => sent.filter((m) => m.type === 'capture.snapshot'),
    healths: () => sent.filter((m) => m.type === 'capture.health'),
    hasObserver: () => observed !== undefined,
  };
}

function row(index: number): Element {
  const element = document.querySelector(`[data-testid="transcript-row"][data-index="${index}"]`);
  if (!element) throw new Error(`no row ${index}`);
  return element;
}

function appendRowLike(source: number, index: number, text: string): void {
  const clone = row(source).cloneNode(true) as Element;
  clone.setAttribute('data-index', String(index));
  clone.setAttribute('data-rs-index', String(index));
  const paragraph = clone.querySelector('p');
  if (paragraph) paragraph.textContent = text;
  row(3).parentElement?.appendChild(clone);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('page capture', () => {
  it('does nothing while capture is off', async () => {
    const t = setup();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.sent).toEqual([]);
    expect(t.hasObserver()).toBe(false);
  });

  it('sends one snapshot and a health report after the page goes quiet', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(1);
    const snapshot = t.snapshots()[0];
    expect(snapshot?.providerId).toBe('claude');
    expect(snapshot?.snapshot.externalConversationId).toBe(CONVERSATION_ID);
    expect(snapshot?.snapshot.messages).toHaveLength(4);
    expect(t.healths()[0]?.health.state).toBe('ok');
  });

  it('does not resend an identical snapshot', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    t.trigger();
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(1);
  });

  it('sends again when the content changes', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    const paragraph = row(2).querySelector('p');
    if (paragraph) paragraph.textContent = 'Changed my mind';
    t.trigger();
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(2);
    expect(t.snapshots()[1]?.snapshot.messages[2]?.text).toBe('Changed my mind');
  });

  it('waits for a streaming reply to finish, then captures it', async () => {
    const t = setup();
    row(3).setAttribute('data-perf-row-streaming', 'true');
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()[0]?.snapshot.messages).toHaveLength(3);

    row(3).setAttribute('data-perf-row-streaming', 'false'); // no mutation callback on purpose
    await vi.advanceTimersByTimeAsync(2100);
    expect(t.snapshots()).toHaveLength(2);
    expect(t.snapshots()[1]?.snapshot.messages).toHaveLength(4);
  });

  it('skips messages written while paused after resuming', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(1);

    t.capture.setStatus('paused');
    appendRowLike(2, 4, 'written while paused');
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(1);

    appendRowLike(2, 5, 'written after resuming');
    t.trigger();
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(2);
    expect(t.snapshots()[1]?.snapshot.messages.map((m: { index: number }) => m.index)).toEqual([5]);
  });

  it('does not save the old conversation under a new URL while the page still shows it', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(1);

    t.state.url = `https://claude.ai/chat/${OTHER_ID}`;
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.snapshots()).toHaveLength(1); // DOM unchanged: still the previous chat's rows

    const paragraph = row(0).querySelector('p');
    if (paragraph) paragraph.textContent = 'A different first message in the new chat';
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.snapshots()).toHaveLength(2);
    expect(t.snapshots()[1]?.snapshot.externalConversationId).toBe(OTHER_ID);
    expect(t.snapshots()[1]?.snapshot.messages[0]?.text).toBe(
      'A different first message in the new chat',
    );
  });

  it('captures after the navigation grace period even if the content looks the same', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);

    t.state.url = `https://claude.ai/chat/${OTHER_ID}`;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(t.snapshots()).toHaveLength(2);
    expect(t.snapshots()[1]?.snapshot.externalConversationId).toBe(OTHER_ID);
  });

  it('reports a page that is not a conversation and sends no snapshot', async () => {
    const t = setup('https://claude.ai/new');
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(0);
    expect(t.healths()).toHaveLength(1);
    expect(t.healths()[0]?.health.state).toBe('no_conversation');
  });

  it('reports health only when it changes', async () => {
    const t = setup();
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    t.trigger();
    await vi.advanceTimersByTimeAsync(1600);
    t.trigger();
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.healths()).toHaveLength(1);
  });

  it('stops everything when stopped', async () => {
    const t = setup();
    t.capture.setStatus('on');
    t.capture.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.sent).toEqual([]);
  });

  it('retries a snapshot that the service worker did not accept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup(CHAT_URL, true);
    t.capture.setStatus('on');
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(1);

    t.trigger();
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.snapshots()).toHaveLength(2);
  });
});