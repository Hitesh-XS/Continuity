import { describe, expect, it } from 'vitest';
import {
  INSERT_ERROR_CODES,
  INSERT_ERROR_TEXT,
  InsertResultSchema,
  MAX_INSERT_CHARS,
  PANEL_ERROR_CODES,
  PanelToPageMessageSchema,
  isTrustedExtensionPage,
} from '../src/handoff/insert-message';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

describe('PanelToPageMessageSchema', () => {
  it('accepts a valid insert request', () => {
    expect(
      PanelToPageMessageSchema.safeParse({ type: 'handoff.insert', providerId: 'claude', text: 'hi' })
        .success,
    ).toBe(true);
  });

  it.each<[string, unknown]>([
    ['empty text', { type: 'handoff.insert', providerId: 'claude', text: '' }],
    ['text that is too long', { type: 'handoff.insert', providerId: 'claude', text: 'x'.repeat(MAX_INSERT_CHARS + 1) }],
    ['another message type', { type: 'capture.getState', providerId: 'claude', text: 'hi' }],
    ['an unknown provider', { type: 'handoff.insert', providerId: 'chatgpt', text: 'hi' }],
    ['missing text', { type: 'handoff.insert', providerId: 'claude' }],
  ])('rejects %s', (_label, value) => {
    expect(PanelToPageMessageSchema.safeParse(value).success).toBe(false);
  });
});

describe('InsertResultSchema', () => {
  it.each(['insertText', 'paste'])('accepts success by %s', (method) => {
    expect(InsertResultSchema.safeParse({ ok: true, method }).success).toBe(true);
  });

  it.each([...INSERT_ERROR_CODES])('accepts the error code %s', (error) => {
    expect(InsertResultSchema.safeParse({ ok: false, error }).success).toBe(true);
  });

  it('rejects an unknown error code', () => {
    expect(InsertResultSchema.safeParse({ ok: false, error: 'oops' }).success).toBe(false);
  });

  it('rejects a success without a method', () => {
    expect(InsertResultSchema.safeParse({ ok: true }).success).toBe(false);
  });
});

describe('INSERT_ERROR_TEXT', () => {
  it.each([...INSERT_ERROR_CODES, ...PANEL_ERROR_CODES])('explains %s', (code) => {
    expect(INSERT_ERROR_TEXT[code].length).toBeGreaterThan(10);
  });
});

describe('isTrustedExtensionPage', () => {
  it('accepts the side panel', () => {
    expect(isTrustedExtensionPage({ id: EXT, url: `chrome-extension://${EXT}/sidepanel.html` }, EXT)).toBe(true);
  });

  it('accepts an extension page opened in a normal tab', () => {
    expect(isTrustedExtensionPage({ id: EXT, url: `chrome-extension://${EXT}/sidepanel.html?x=1` }, EXT)).toBe(true);
  });

  it('rejects another extension', () => {
    expect(isTrustedExtensionPage({ id: 'other', url: 'chrome-extension://other/page.html' }, EXT)).toBe(false);
  });

  it('rejects a web page, even one claiming our id', () => {
    expect(isTrustedExtensionPage({ id: EXT, url: 'https://claude.ai/new' }, EXT)).toBe(false);
  });

  it('rejects a missing url', () => {
    expect(isTrustedExtensionPage({ id: EXT }, EXT)).toBe(false);
  });

  it('rejects a lookalike host', () => {
    expect(isTrustedExtensionPage({ id: EXT, url: `chrome-extension://${EXT}.evil/page.html` }, EXT)).toBe(false);
  });

  it('rejects a missing sender id', () => {
    expect(isTrustedExtensionPage({ url: `chrome-extension://${EXT}/sidepanel.html` }, EXT)).toBe(false);
  });
});