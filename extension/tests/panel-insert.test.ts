import { describe, expect, it, vi } from 'vitest';
import { insertViaTab, type PanelInsertDeps } from '../src/handoff/panel-insert';

const NEW_CHAT = { id: 7, url: 'https://claude.ai/new' };
const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

function makeDeps(
  overrides: Partial<PanelInsertDeps> = {},
): PanelInsertDeps & { sendMessage: ReturnType<typeof vi.fn>; injectScript: ReturnType<typeof vi.fn> } {
  return {
    queryActiveTab: async () => NEW_CHAT,
    sendMessage: vi.fn(async () => ({ ok: true, method: 'insertText' })),
    injectScript: vi.fn(async () => undefined),
    wait: async () => undefined,
    ...overrides,
  } as PanelInsertDeps & {
    sendMessage: ReturnType<typeof vi.fn>;
    injectScript: ReturnType<typeof vi.fn>;
  };
}

describe('insertViaTab', () => {
  it('returns the page result and sends exactly one well-formed message', async () => {
    const deps = makeDeps();
    expect(await insertViaTab(deps, 'package')).toEqual({ ok: true, method: 'insertText' });
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledWith(7, {
      type: 'handoff.insert',
      providerId: 'claude',
      text: 'package',
    });
    expect(deps.injectScript).not.toHaveBeenCalled();
  });

  it('passes an error result from the page through, without retrying', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn(async () => ({ ok: false, error: 'composer_not_empty' })),
    });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'composer_not_empty' });
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('reports no_claude_tab when there is no tab', async () => {
    const deps = makeDeps({ queryActiveTab: async () => undefined });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'no_claude_tab' });
  });

  it('reports no_claude_tab when the tab query fails', async () => {
    const deps = makeDeps({
      queryActiveTab: async () => {
        throw new Error('boom');
      },
    });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'no_claude_tab' });
  });

  it('does not message a tab that is not Claude', async () => {
    const deps = makeDeps({ queryActiveTab: async () => ({ id: 3, url: 'https://example.com/new' }) });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'no_claude_tab' });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('does not message a Claude tab that is not a new chat', async () => {
    const deps = makeDeps({
      queryActiveTab: async () => ({
        id: 3,
        url: 'https://claude.ai/chat/0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab',
      }),
    });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'not_new_chat' });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('treats a tab without a visible url as not Claude', async () => {
    const deps = makeDeps({ queryActiveTab: async () => ({ id: 3 }) });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'no_claude_tab' });
  });

  it('starts the page script and retries once when nothing is listening', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(NO_RECEIVER)
      .mockResolvedValueOnce({ ok: true, method: 'paste' });
    const deps = makeDeps({ sendMessage });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: true, method: 'paste' });
    expect(deps.injectScript).toHaveBeenCalledTimes(1);
    expect(deps.injectScript).toHaveBeenCalledWith(7);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('gives up with no_receiver after exactly one injection', async () => {
    const deps = makeDeps({ sendMessage: vi.fn(async () => Promise.reject(NO_RECEIVER)) });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'no_receiver' });
    expect(deps.injectScript).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reports inject_failed when the script cannot be started, without retrying', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn(async () => Promise.reject(NO_RECEIVER)),
      injectScript: vi.fn(async () => Promise.reject(new Error('Cannot access contents'))),
    });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'inject_failed' });
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('never retries after the page received the request but did not answer', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn(async () =>
        Promise.reject(new Error('The message port closed before a response was received.')),
      ),
    });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'port_closed' });
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.injectScript).not.toHaveBeenCalled();
  });

  it('reports other failures as unreachable, without injecting', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn(async () => Promise.reject(new Error('something else'))),
    });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'unreachable' });
    expect(deps.injectScript).not.toHaveBeenCalled();
  });

  it('reports a malformed answer as bad_response', async () => {
    const deps = makeDeps({ sendMessage: vi.fn(async () => ({ hello: 'world' })) });
    expect(await insertViaTab(deps, 'p')).toEqual({ ok: false, error: 'bad_response' });
  });
});