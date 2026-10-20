import { describe, expect, it } from 'vitest';
import { CreateCheckpointInputSchema, linesToList } from '../src/checkpoints/schema';

const valid = { objective: 'Ship it', nextAction: 'Write tests' };

describe('linesToList', () => {
  it('turns text into trimmed non-empty lines', () => {
    expect(linesToList('  a  \n\n b\r\n   \nc')).toEqual(['a', 'b', 'c']);
  });

  it('strips bullet and number markers', () => {
    expect(linesToList('- a\n* b\n• c\n1. d\n2) e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns an empty list for blank text', () => {
    expect(linesToList('')).toEqual([]);
    expect(linesToList('  \n \n')).toEqual([]);
  });
});

describe('CreateCheckpointInputSchema', () => {
  it('accepts the minimal input and fills defaults', () => {
    expect(CreateCheckpointInputSchema.parse(valid)).toEqual({
      objective: 'Ship it',
      nextAction: 'Write tests',
      decisions: [],
      completed: [],
      blockers: [],
      notes: '',
      conversationIds: [],
    });
  });

  it.each<[string, unknown]>([
    ['blank objective', { ...valid, objective: '   ' }],
    ['blank next action', { ...valid, nextAction: '' }],
    ['objective too long', { ...valid, objective: 'x'.repeat(2001) }],
    ['next action too long', { ...valid, nextAction: 'x'.repeat(2001) }],
    ['too many decisions', { ...valid, decisions: Array.from({ length: 101 }, () => 'x') }],
    ['a decision that is too long', { ...valid, decisions: ['x'.repeat(1001)] }],
    ['notes too long', { ...valid, notes: 'x'.repeat(20_001) }],
    ['decisions that are not a list', { ...valid, decisions: 'a, b' }],
  ])('rejects %s', (_label, input) => {
    expect(CreateCheckpointInputSchema.safeParse(input).success).toBe(false);
  });
});