import { describe, expect, it } from 'vitest';
import { MAX_MESSAGES_PER_SNAPSHOT, SnapshotSchema, hashText } from '../src/capture/snapshot';

const base = () => ({
  externalConversationId: 'abc-123',
  messages: [{ role: 'user', text: 'Hello' }],
});

describe('SnapshotSchema', () => {
  it('accepts a minimal snapshot', () => {
    expect(SnapshotSchema.safeParse(base()).success).toBe(true);
  });

  it('accepts message keys and a title', () => {
    const result = SnapshotSchema.safeParse({
      externalConversationId: 'abc',
      title: 'My chat',
      messages: [
        { key: 'm1', role: 'user', text: 'Hi' },
        { key: 'm2', role: 'assistant', text: 'Hello' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['no messages', { ...base(), messages: [] }],
    [
      'too many messages',
      {
        ...base(),
        messages: Array.from({ length: MAX_MESSAGES_PER_SNAPSHOT + 1 }, () => ({
          role: 'user',
          text: 'x',
        })),
      },
    ],
    ['unknown role', { ...base(), messages: [{ role: 'robot', text: 'x' }] }],
    ['text too long', { ...base(), messages: [{ role: 'user', text: 'x'.repeat(200_001) }] }],
    ['conversation id with a slash', { ...base(), externalConversationId: 'a/b' }],
    ['empty conversation id', { ...base(), externalConversationId: '' }],
    ['key with a space', { ...base(), messages: [{ key: 'a b', role: 'user', text: 'x' }] }],
    ['title too long', { ...base(), title: 'x'.repeat(301) }],
    [
      'duplicate keys',
      {
        ...base(),
        messages: [
          { key: 'k', role: 'user', text: 'a' },
          { key: 'k', role: 'assistant', text: 'b' },
        ],
      },
    ],
    [
      'total text too large',
      {
        ...base(),
        messages: Array.from({ length: 30 }, () => ({ role: 'user', text: 'x'.repeat(190_000) })),
      },
    ],
  ])('rejects %s', (_label: string, value: unknown) => {
    expect(SnapshotSchema.safeParse(value).success).toBe(false);
  });
});

describe('hashText', () => {
  it('is deterministic and returns 64 hex characters', async () => {
    const first = await hashText('hello');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashText('hello')).toBe(first);
  });

  it('differs for different text', async () => {
    expect(await hashText('hello')).not.toBe(await hashText('hello!'));
  });
});