import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema, TabStatusSchema, tabStatusKey } from '../src/shared/messages';

describe('ExtensionMessageSchema', () => {
  it('accepts content.ready', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'content.ready',
      providerId: 'claude',
      path: '/chat/1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts capture.getState', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'capture.getState',
      providerId: 'claude',
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['unknown type', { type: 'nope', providerId: 'claude' }],
    ['missing provider', { type: 'capture.getState' }],
    ['unknown provider', { type: 'capture.getState', providerId: 'chatgpt' }],
    ['overlong path', { type: 'content.ready', providerId: 'claude', path: 'x'.repeat(3000) }],
    ['null', null],
    ['a string', 'content.ready'],
  ])('rejects %s', (_label: string, value: unknown) => {
    expect(ExtensionMessageSchema.safeParse(value).success).toBe(false);
  });
});

describe('TabStatusSchema', () => {
  it('parses a valid record', () => {
    const record = { providerId: 'claude', path: '/chat/1', seenAt: '2026-10-17T10:00:00.000Z' };
    expect(TabStatusSchema.parse(record)).toEqual(record);
  });

  it('rejects an invalid record', () => {
    expect(TabStatusSchema.safeParse({ providerId: 'x', path: 1 }).success).toBe(false);
  });

  it('builds a stable storage key', () => {
    expect(tabStatusKey(42)).toBe('tabStatus:42');
  });
});