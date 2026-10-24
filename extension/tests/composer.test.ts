// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findComposer,
  insertIntoComposer,
  isComposerEmpty,
  isNewChatUrl,
  verifyInserted,
} from '../src/handoff/composer';

const COMPOSER_HTML = `
<form>
  <div contenteditable="true" role="textbox" data-testid="chat-input" class="tiptap ProseMirror" data-doc-empty="true" tabindex="0">
    <p class="is-empty is-editor-empty"><br class="ProseMirror-trailingBreak"></p>
  </div>
  <button type="button" data-testid="chat-input-send">Send</button>
</form>`;

const PACKAGE = [
  '<project_context>',
  'Saved context from my earlier work.',
  '',
  '## Objective',
  '',
  'Ship the login page',
  '',
  '## Next action',
  '',
  'Write the login view tests',
  '</project_context>',
  '',
].join('\n');

const noWait = async (): Promise<void> => undefined;

class FakeDataTransfer {
  private data = new Map<string, string>();
  setData(type: string, value: string): void {
    this.data.set(type, value);
  }
  getData(type: string): string {
    return this.data.get(type) ?? '';
  }
}

class FakeClipboardEvent extends Event {
  clipboardData: FakeDataTransfer | null;
  constructor(type: string, init?: EventInit & { clipboardData?: FakeDataTransfer }) {
    super(type, init);
    this.clipboardData = init?.clipboardData ?? null;
  }
}

const win = (): Record<string, unknown> => document.defaultView as unknown as Record<string, unknown>;

function editor(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="chat-input"]');
  if (!element) throw new Error('no editor');
  return element;
}

function writeParagraphs(target: HTMLElement, text: string, dropBlank = false): void {
  target.innerHTML = '';
  for (const line of text.split('\n')) {
    if (dropBlank && line === '') continue;
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    target.appendChild(paragraph);
  }
}

function installExecCommand(handler: (command: string, value?: string) => boolean) {
  const fn = vi.fn((command: string, _ui?: boolean, value?: string) => handler(command, value));
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true });
  return fn;
}

function onPaste(listener: (text: string) => void): void {
  editor().addEventListener('paste', (event) => {
    listener((event as unknown as FakeClipboardEvent).clipboardData?.getData('text/plain') ?? '');
  });
}

beforeEach(() => {
  document.body.innerHTML = COMPOSER_HTML;
  win().DataTransfer = FakeDataTransfer;
  win().ClipboardEvent = FakeClipboardEvent;
});

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).execCommand;
  delete win().DataTransfer;
  delete win().ClipboardEvent;
  document.body.innerHTML = '';
});

describe('isNewChatUrl', () => {
  it.each([
    'https://claude.ai/new',
    'https://claude.ai/new?x=1',
    'https://claude.ai/',
    'https://claude.ai',
  ])('accepts %s', (url) => {
    expect(isNewChatUrl(url)).toBe(true);
  });

  it.each([
    'https://claude.ai/chat/0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab',
    'https://claude.ai/recents',
    'https://evil.example/new',
    'http://claude.ai/new',
    'https://claude.ai/new/extra',
    'not a url',
    undefined,
  ])('rejects %s', (url) => {
    expect(isNewChatUrl(url)).toBe(false);
  });
});

describe('findComposer', () => {
  it('finds the chat input', () => {
    expect(findComposer(document)).toBe(editor());
  });

  it('falls back to a ProseMirror editor', () => {
    document.body.innerHTML = '<div class="ProseMirror" contenteditable="true" id="fb"></div>';
    expect(findComposer(document)?.id).toBe('fb');
  });

  it('returns null when there is no editor', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(findComposer(document)).toBeNull();
  });

  it('ignores an editor that is not editable', () => {
    document.body.innerHTML = '<div data-testid="chat-input" contenteditable="false"></div>';
    expect(findComposer(document)).toBeNull();
  });

  it('prefers the chat input over the fallback', () => {
    document.body.innerHTML =
      '<div class="ProseMirror" contenteditable="true" id="f"></div><div data-testid="chat-input" contenteditable="true" id="p"></div>';
    expect(findComposer(document)?.id).toBe('p');
  });
});

describe('isComposerEmpty', () => {
  it('is empty for the placeholder paragraph', () => {
    expect(isComposerEmpty(editor())).toBe(true);
  });

  it('is not empty when there is text', () => {
    writeParagraphs(editor(), 'my draft');
    expect(isComposerEmpty(editor())).toBe(false);
  });

  it('treats whitespace as empty', () => {
    writeParagraphs(editor(), '   ');
    expect(isComposerEmpty(editor())).toBe(true);
  });
});

describe('verifyInserted', () => {
  const X = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');

  it('accepts identical text', () => {
    expect(verifyInserted(X, X)).toBe(true);
  });

  it('ignores whitespace differences', () => {
    expect(verifyInserted(X.replace(/\s/g, ''), X)).toBe(true);
  });

  it('rejects an empty editor', () => {
    expect(verifyInserted('', X)).toBe(false);
  });

  it('rejects a truncated insertion', () => {
    expect(verifyInserted(X.slice(0, 100), X)).toBe(false);
  });

  it('rejects a duplicated insertion', () => {
    expect(verifyInserted(X + X, X)).toBe(false);
  });

  it('rejects text whose start is wrong', () => {
    expect(verifyInserted(`Q${X.slice(1)}`, X)).toBe(false);
  });
});

describe('insertIntoComposer', () => {
  it('inserts with insertText and reports the method', async () => {
    const exec = installExecCommand((command, value) => {
      if (command !== 'insertText') return false;
      writeParagraphs(editor(), value ?? '');
      return true;
    });
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: true,
      method: 'insertText',
    });
    expect(exec).toHaveBeenCalledWith('insertText', false, PACKAGE);
  });

  it('tolerates an editor that drops blank lines', async () => {
    installExecCommand((command, value) => {
      if (command !== 'insertText') return false;
      writeParagraphs(editor(), value ?? '', true);
      return true;
    });
    expect((await insertIntoComposer(document, PACKAGE, { wait: noWait })).ok).toBe(true);
  });

  it('falls back to paste when insertText does nothing', async () => {
    installExecCommand(() => false);
    onPaste((text) => writeParagraphs(editor(), text));
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: true,
      method: 'paste',
    });
  });

  it('reports insert_failed when nothing works, leaving the box empty', async () => {
    installExecCommand(() => false);
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: false,
      error: 'insert_failed',
    });
    expect(isComposerEmpty(editor())).toBe(true);
  });

  it('cleans up a partial insert, then succeeds with paste', async () => {
    const exec = installExecCommand((command, value) => {
      if (command === 'insertText') {
        writeParagraphs(editor(), (value ?? '').slice(0, 40));
        return true;
      }
      if (command === 'delete') {
        editor().innerHTML = '<p class="is-empty"><br></p>';
        return true;
      }
      return command === 'selectAll';
    });
    onPaste((text) => writeParagraphs(editor(), text));
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: true,
      method: 'paste',
    });
    expect(exec).toHaveBeenCalledWith('selectAll', false);
    expect(exec).toHaveBeenCalledWith('delete', false);
  });

  it('stops with left_partial when partial text cannot be cleared, without pasting', async () => {
    installExecCommand((command, value) => {
      if (command === 'insertText') {
        writeParagraphs(editor(), (value ?? '').slice(0, 40));
        return true;
      }
      return false;
    });
    const pasted = vi.fn();
    onPaste(pasted);
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: false,
      error: 'left_partial',
    });
    expect(pasted).not.toHaveBeenCalled();
  });

  it('refuses a message box that already has text, without editing it', async () => {
    writeParagraphs(editor(), 'my draft');
    const exec = installExecCommand(() => true);
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: false,
      error: 'composer_not_empty',
    });
    expect(exec).not.toHaveBeenCalled();
    expect(editor().textContent).toBe('my draft');
  });

  it('reports composer_not_found when there is no message box', async () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(await insertIntoComposer(document, PACKAGE, { wait: noWait })).toEqual({
      ok: false,
      error: 'composer_not_found',
    });
  });

  it('never clicks Send or submits the form', async () => {
    installExecCommand((command, value) => {
      if (command !== 'insertText') return false;
      writeParagraphs(editor(), value ?? '');
      return true;
    });
    const clicked = vi.fn();
    const submitted = vi.fn();
    document.querySelector('[data-testid="chat-input-send"]')?.addEventListener('click', clicked);
    document.querySelector('form')?.addEventListener('submit', submitted);
    expect((await insertIntoComposer(document, PACKAGE, { wait: noWait })).ok).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('focuses the message box before inserting', async () => {
    let focused: Element | null = null;
    installExecCommand((command, value) => {
      if (command !== 'insertText') return false;
      focused = document.activeElement;
      writeParagraphs(editor(), value ?? '');
      return true;
    });
    await insertIntoComposer(document, PACKAGE, { wait: noWait });
    expect(focused).toBe(editor());
  });
});