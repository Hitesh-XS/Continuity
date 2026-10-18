import { describe, expect, it, vi } from 'vitest';
import type { CaptureStatus } from '../src/shared/messages';
import { routeMessage, type RouterDeps } from '../src/shared/router';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const NOW = '2026-10-17T10:00:00.000Z';
const goodSender = { id: EXT_ID, url: 'https://claude.ai/chat/1', tab: { id: 7 } };
const readyMessage = { type: 'content.ready', providerId: 'claude', path: '/chat/1' };

function makeDeps(status: CaptureStatus = 'on'): RouterDeps {
  return {
    extensionId: EXT_ID,
    getCaptureStatus: vi.fn(async () => status),
    saveTabStatus: vi.fn(async () => undefined),
    ingest: vi.fn(async () => ({
      conversationId: 'claude:abc',
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
      path: '/chat/1',
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
    snapshot: { externalConversationId: 'abc', messages: [{ role: 'user', text: 'Hi' }] },
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
    const bad = { ...snapshotMessage, snapshot: { externalConversationId: 'abc', messages: [] } };
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
});