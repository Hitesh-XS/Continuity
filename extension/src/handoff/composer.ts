import { CLAUDE } from '../shared/providers';

/**
 * Everything that touches Claude's message box lives here. It NEVER sends anything:
 * there is deliberately no reference to the Send button in this file.
 * Selectors observed on claude.ai/new (Oct 2026). If Claude changes its page, fix them HERE.
 */
export const COMPOSER_SELECTORS = {
  primary: '[contenteditable="true"][data-testid="chat-input"]',
  fallback: '.ProseMirror[contenteditable="true"]',
} as const;

export type InsertMethod = 'insertText' | 'paste';
export type ComposerInsertError =
  | 'composer_not_found'
  | 'composer_not_empty'
  | 'insert_failed'
  | 'left_partial';
export type ComposerInsertResult =
  | { ok: true; method: InsertMethod }
  | { ok: false; error: ComposerInsertError };

export interface ComposerDeps {
  wait?: (ms: number) => Promise<void>;
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** True only for a new, empty chat: claude.ai/new or the home page. */
export function isNewChatUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === CLAUDE.origin &&
      (parsed.pathname === '/new' || parsed.pathname === '/new/' || parsed.pathname === '/')
    );
  } catch {
    return false;
  }
}

export function findComposer(root: ParentNode): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(COMPOSER_SELECTORS.primary) ??
    root.querySelector<HTMLElement>(COMPOSER_SELECTORS.fallback)
  );
}

export function isComposerEmpty(editor: HTMLElement): boolean {
  return (editor.textContent ?? '').trim() === '';
}

const compact = (text: string): string => text.replace(/\s+/g, '');

/**
 * Did the whole package land, once, in the editor? Whitespace is ignored because the editor
 * turns line breaks into paragraphs. Catches truncation, duplication and a missing start or end.
 */
export function verifyInserted(editorText: string, expected: string): boolean {
  const inEditor = compact(editorText);
  const wanted = compact(expected);
  if (wanted === '' || inEditor === '') return false;
  if (inEditor.length < wanted.length * 0.95) return false;
  if (inEditor.length > wanted.length * 1.1 + 10) return false;
  const edge = Math.min(40, wanted.length);
  return inEditor.includes(wanted.slice(0, edge)) && inEditor.includes(wanted.slice(-edge));
}

function placeCaretAtEnd(doc: Document, editor: HTMLElement): void {
  editor.focus({ preventScroll: true });
  const selection = doc.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function tryInsertText(doc: Document, text: string): void {
  if (typeof doc.execCommand !== 'function') return;
  // The return value is ignored on purpose: the editor's content is checked afterwards.
  doc.execCommand('insertText', false, text);
}

function tryPaste(doc: Document, editor: HTMLElement, text: string): void {
  const win = doc.defaultView;
  if (!win || typeof win.DataTransfer !== 'function' || typeof win.ClipboardEvent !== 'function') {
    return;
  }
  const transfer = new win.DataTransfer();
  transfer.setData('text/plain', text);
  editor.dispatchEvent(
    new win.ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
  );
}

function clearEditor(doc: Document, editor: HTMLElement): void {
  editor.focus({ preventScroll: true });
  if (typeof doc.execCommand !== 'function') return;
  doc.execCommand('selectAll', false);
  doc.execCommand('delete', false);
}

export async function insertIntoComposer(
  doc: Document,
  text: string,
  deps: ComposerDeps = {},
): Promise<ComposerInsertResult> {
  const wait = deps.wait ?? defaultWait;
  const editor = findComposer(doc);
  if (!editor) return { ok: false, error: 'composer_not_found' };
  if (!isComposerEmpty(editor)) return { ok: false, error: 'composer_not_empty' };

  const methods: [InsertMethod, () => void][] = [
    ['insertText', () => tryInsertText(doc, text)],
    ['paste', () => tryPaste(doc, editor, text)],
  ];
  for (const [method, run] of methods) {
    placeCaretAtEnd(doc, editor);
    run();
    await wait(60);
    if (verifyInserted(editor.textContent ?? '', text)) return { ok: true, method };
    if (!isComposerEmpty(editor)) {
      // Something landed but not all of it: remove it before trying anything else.
      clearEditor(doc, editor);
      await wait(30);
      if (!isComposerEmpty(editor)) return { ok: false, error: 'left_partial' };
    }
  }
  return { ok: false, error: 'insert_failed' };
}