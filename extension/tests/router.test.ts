import { describe, expect, it, vi } from 'vitest';
import type { CaptureStatus } from '../src/shared/messages';
import { routeMessage, type RouterDeps } from '../src/shared/router';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const NOW = '2026-10-17T10:00:00.000Z';
const CONVERSATION_ID = '0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab';
const goodSender = {
  id: EXT_ID,
  url: `https://claude.ai/chat/${CONVERSATION_ID}`,
  tab: { id: 7 },
};
const readyMessage = { type: 'content.ready', providerId: 'claude', path: '/chat/x' };

function makeDeps(status: CaptureStatus = 'on'): RouterDeps {
  return {
    extensionId: EXT_ID,
    getCaptureStatus: vi.fn(async () => status),
    saveTabStatus: vi.fn(async () => undefined),
    saveAdapterHealth: vi.fn(async () => undefined),
    ingest: vi.fn(async () => ({
      conversationId: `claude:${CONVERSATION_ID}`,
      inserted: 2,
      updated: 0,
      unchanged: 0,
    })),
    now: () => NOW,
  };
}

describe('routeMessage', () => {
  it('stores tab status for content.ready from a Claude tab', async () => {
    const deps = makeDeps();
    expect(await routeMessage(readyMessage, goodSender, deps)).toEqual({ ok: true });
    expect(deps.saveTabStatus).toHaveBeenCalledWith(7, {
      providerId: 'claude',
      path: '/chat/x',
      seenAt: NOW,
    });
  });

  it('answers capture.getState with the current status', async () => {
    const deps = makeDeps();
    const response = await routeMessage(
      { type: 'capture.getState', providerId: 'claude' },
      goodSender,
      deps,
    );
    expect(response).toEqual({ ok: true, status: 'on' });
  });

  it('rejects messages from another extension', async () => {
    const deps = makeDeps();
    const response = await routeMessage(readyMessage, { ...goodSender, id: 'other' }, deps);
    expect(response).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.saveTabStatus).not.toHaveBeenCalled();
  });

  it('rejects content messages that do not come from a tab', async () => {
    const deps = makeDeps();
    const response = await routeMessage(readyMessage, { id: EXT_ID, url: goodSender.url }, deps);
    expect(response).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.saveTabStatus).not.toHaveBeenCalled();
  });

  it('rejects a Claude message sent from a different origin', async () => {
    const deps = makeDeps();
    const response = await routeMessage(
      readyMessage,
      { id: EXT_ID, url: 'https://evil.example/', tab: { id: 7 } },
      deps,
    );
    expect(response).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.saveTabStatus).not.toHaveBeenCalled();
  });

  it('reports invalid messages from a trusted sender', async () => {
    const response = await routeMessage({ type: 'nope' }, goodSender, makeDeps());
    expect(response).toEqual({ ok: false, error: 'invalid_message' });
  });

  it('checks the sender before looking at the message', async () => {
    const response = await routeMessage('garbage', { id: 'other' }, makeDeps());
    expect(response).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('routeMessage: capture.snapshot', () => {
  const snapshotMessage = {
    type: 'capture.snapshot',
    providerId: 'claude',
    snapshot: {
      externalConversationId: CONVERSATION_ID,
      messages: [{ index: 0, role: 'user', text: 'Hi' }],
    },
  };

  it('ingests the snapshot when capture is on', async () => {
    const deps = makeDeps('on');
    const response = await routeMessage(snapshotMessage, goodSender, deps);
    expect(response).toEqual({ ok: true, ingested: { inserted: 2, updated: 0, unchanged: 0 } });
    expect(deps.ingest).toHaveBeenCalledWith('claude', snapshotMessage.snapshot);
  });

  it('refuses the snapshot when capture is off', async () => {
    const deps = makeDeps('off');
    const response = await routeMessage(snapshotMessage, goodSender, deps);
    expect(response).toEqual({ ok: false, error: 'capture_inactive' });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it('refuses the snapshot when capture is paused', async () => {
    const deps = makeDeps('paused');
    const response = await routeMessage(snapshotMessage, goodSender, deps);
    expect(response).toEqual({ ok: false, error: 'capture_inactive' });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it('refuses an invalid snapshot', async () => {
    const deps = makeDeps('on');
    const bad = {
      ...snapshotMessage,
      snapshot: { externalConversationId: CONVERSATION_ID, messages: [] },
    };
    expect(await routeMessage(bad, goodSender, deps)).toEqual({
      ok: false,
      error: 'invalid_message',
    });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it('refuses a snapshot sent from a different origin', async () => {
    const deps = makeDeps('on');
    const response = await routeMessage(
      snapshotMessage,
      { id: EXT_ID, url: 'https://evil.example/', tab: { id: 7 } },
      deps,
    );
    expect(response).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it('refuses a snapshot for a different conversation than the tab is showing', async () => {
    const deps = makeDeps('on');
    const other = {
      ...snapshotMessage,
      snapshot: { ...snapshotMessage.snapshot, externalConversationId: 'ffffffff-1111-4222-8333-444444444444' },
    };
    expect(await routeMessage(other, goodSender, deps)).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it('refuses a snapshot from a page that is not a conversation', async () => {
    const deps = makeDeps('on');
    const response = await routeMessage(
      snapshotMessage,
      { id: EXT_ID, url: 'https://claude.ai/new', tab: { id: 7 } },
      deps,
    );
    expect(response).toEqual({ ok: false, error: 'forbidden' });
    expect(deps.ingest).not.toHaveBeenCalled();
  });
});

describe('routeMessage: capture.health', () => {
  const health = { state: 'ok', rows: 4, extracted: 4, unrecognized: 0 };

  it('stores the health report for the sender tab', async () => {
    const deps = makeDeps();
    const response = await routeMessage(
      { type: 'capture.health', providerId: 'claude', health },
      goodSender,
      deps,
    );
    expect(response).toEqual({ ok: true });
    expect(deps.saveAdapterHealth).toHaveBeenCalledWith(7, {
      providerId: 'claude',
      ...health,
      seenAt: NOW,
    });
  });

  it('rejects an invalid health report', async () => {
    const deps = makeDeps();
    const response = await routeMessage(
      { type: 'capture.health', providerId: 'claude', health: { ...health, rows: -5 } },
      goodSender,
      deps,
    );
    expect(response).toEqual({ ok: false, error: 'invalid_message' });
    expect(deps.saveAdapterHealth).not.toHaveBeenCalled();
  });
});