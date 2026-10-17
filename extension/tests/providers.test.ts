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