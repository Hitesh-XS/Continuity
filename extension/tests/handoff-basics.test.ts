import { describe, expect, it } from 'vitest';
import { DESTINATIONS, DESTINATION_IDS } from '../src/handoff/destinations';
import { estimateTokens } from '../src/handoff/estimate';

describe('estimateTokens', () => {
  it('is zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses 3.5 characters per token', () => {
    expect(estimateTokens('x'.repeat(350))).toBe(100);
    expect(estimateTokens('x'.repeat(7))).toBe(2);
  });

  it('rounds up', () => {
    expect(estimateTokens('x'.repeat(8))).toBe(3);
  });

  it('never decreases as text grows', () => {
    let previous = 0;
    for (let length = 0; length <= 50; length += 1) {
      const current = estimateTokens('x'.repeat(length));
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('destinations', () => {
  it('offers Claude and a generic format', () => {
    expect([...DESTINATION_IDS].sort()).toEqual(['claude', 'generic']);
  });

  it.each([...DESTINATION_IDS])('%s: the default budget is one of its options', (id) => {
    const profile = DESTINATIONS[id];
    expect(profile.budgetOptions).toContain(profile.defaultBudget);
  });

  it.each([...DESTINATION_IDS])('%s: budget options are in ascending order', (id) => {
    const options = [...DESTINATIONS[id].budgetOptions];
    expect(options).toEqual([...options].sort((a, b) => a - b));
  });
});