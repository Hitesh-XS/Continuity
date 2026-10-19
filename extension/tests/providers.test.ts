import { describe, expect, it } from 'vitest';
import { CLAUDE, PROVIDERS, providerForUrl } from '../src/shared/providers';

describe('provider registry', () => {
  it('describes Claude with an exact origin and one narrow match pattern', () => {
    expect(PROVIDERS).toContain(CLAUDE);
    expect(CLAUDE.origin).toBe('https://claude.ai');
    expect(CLAUDE.matches).toEqual(['https://claude.ai/*']);
  });

  it('recognises claude.ai pages', () => {
    expect(providerForUrl('https://claude.ai/chat/abc')?.id).toBe('claude');
    expect(providerForUrl('https://claude.ai/')?.id).toBe('claude');
  });

  it.each([
    'http://claude.ai/',
    'https://claude.ai.evil.example/',
    'https://evilclaude.ai/',
    'https://www.claude.ai/',
    'not a url',
    undefined,
  ])('rejects %s', (url) => {
    expect(providerForUrl(url)).toBeUndefined();
  });
});

describe('CLAUDE.conversationIdFromUrl', () => {
  const ID = '0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab';

  it.each([
    `https://claude.ai/chat/${ID}`,
    `https://claude.ai/chat/${ID}/`,
    `https://claude.ai/chat/${ID}?x=1#top`,
  ])('reads the id from %s', (url) => {
    expect(CLAUDE.conversationIdFromUrl(url)).toBe(ID);
  });

  it.each([
    'https://claude.ai/new',
    'https://claude.ai/chat/',
    'https://claude.ai/chat/short',
    'https://claude.ai/recents',
    `https://claude.ai/chat/${ID}/extra`,
    `https://claude.ai.evil.example/chat/${ID}`,
    `http://claude.ai/chat/${ID}`,
    'not a url',
    undefined,
  ])('returns nothing for %s', (url) => {
    expect(CLAUDE.conversationIdFromUrl(url)).toBeUndefined();
  });
});