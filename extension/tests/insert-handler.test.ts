// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleInsertRequest } from '../src/handoff/insert-handler';
import type { CaptureStatus } from '../src/shared/messages';

const COMPOSER_HTML = `<div contenteditable="true" role="textbox" data-testid="chat-input" class="tiptap ProseMirror" tabindex="0"><p class="is-empty"><br></p></div>`;
const PACKAGE = 'Saved context.\n\n## Objective\n\nShip the login page\n\n## Next action\n\nWrite the tests\n';

function setup(status: CaptureStatus | undefined | 'throw', url = 'https://claude.ai/new') {
  document.body.innerHTML = COMPOSER_HTML;
  const editor = document.querySelector<HTMLElement>('[data-testid="chat-input"]') as HTMLElement;
  const exec = vi.fn((command: string, _ui?: boolean, value?: string) => {
    if (command !== 'insertText') return false;
    editor.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = value ?? '';
    editor.appendChild(paragraph);
    return true;
  });
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true });
  const deps = {
    doc: document,
    getUrl: () => url,
    getStatus: async (): Promise<CaptureStatus | undefined> => {
      if (status === 'throw') throw new Error('no connection');
      return status;
    },
    wait: async (): Promise<void> => undefined,
  };
  return { editor, exec, deps };
}

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).execCommand;
  document.body.innerHTML = '';
});

describe('handleInsertRequest', () => {
  it('inserts when capture is on', async () => {
    const t = setup('on');
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({ ok: true, method: 'insertText' });
  });

  it('inserts when capture is paused', async () => {
    const t = setup('paused');
    expect((await handleInsertRequest(t.deps, PACKAGE)).ok).toBe(true);
  });

  it('refuses when Claude access is off, without touching the page', async () => {
    const t = setup('off');
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({ ok: false, error: 'access_off' });
    expect(t.exec).not.toHaveBeenCalled();
    expect(t.editor.textContent).toBe('');
  });

  it('treats a status that cannot be read as access off', async () => {
    const t = setup('throw');
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({ ok: false, error: 'access_off' });
    expect(t.exec).not.toHaveBeenCalled();
  });

  it('treats a missing status as access off', async () => {
    const t = setup(undefined);
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({ ok: false, error: 'access_off' });
  });

  it('refuses outside a new chat, without touching the page', async () => {
    const t = setup('on', 'https://claude.ai/chat/0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab');
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({ ok: false, error: 'not_new_chat' });
    expect(t.exec).not.toHaveBeenCalled();
  });

  it('passes message-box errors through', async () => {
    const t = setup('on');
    t.editor.innerHTML = '<p>my draft</p>';
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({
      ok: false,
      error: 'composer_not_empty',
    });
    expect(t.exec).not.toHaveBeenCalled();
  });

  it('checks Claude access before the page address', async () => {
    const t = setup('off', 'https://claude.ai/recents');
    expect(await handleInsertRequest(t.deps, PACKAGE)).toEqual({ ok: false, error: 'access_off' });
  });
});