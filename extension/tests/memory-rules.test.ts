import { describe, expect, it } from 'vitest';
import { canTransition, chooseInitialStatus, normalizeText } from '../src/memory/rules';
import type { MemoryKind, MemoryStatus } from '../src/memory/types';

describe('normalizeText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeText('  Uses   JWT\n')).toBe('uses jwt');
  });
});

describe('chooseInitialStatus', () => {
  it.each<[MemoryKind, MemoryStatus]>([
    ['fact', 'confirmed'],
    ['preference', 'confirmed'],
    ['decision', 'confirmed'],
    ['hypothesis', 'proposed'],
    ['task', 'open'],
    ['blocker', 'open'],
  ])('starts a user-created %s as %s', (kind, status) => {
    expect(chooseInitialStatus(kind, 'user')).toBe(status);
  });

  it.each<[MemoryKind, MemoryStatus]>([
    ['fact', 'proposed'],
    ['preference', 'proposed'],
    ['decision', 'proposed'],
    ['hypothesis', 'proposed'],
    ['task', 'open'],
    ['blocker', 'open'],
  ])('starts an extracted %s as %s', (kind, status) => {
    expect(chooseInitialStatus(kind, 'extracted')).toBe(status);
  });

  it.each<[MemoryKind, MemoryStatus]>([
    ['fact', 'proposed'],
    ['decision', 'proposed'],
    ['hypothesis', 'confirmed'],
    ['task', 'done'],
    ['blocker', 'resolved'],
  ])('lets a user start a %s as %s', (kind, status) => {
    expect(chooseInitialStatus(kind, 'user', status)).toBe(status);
  });

  it.each<[MemoryKind, MemoryStatus]>([
    ['fact', 'open'],
    ['task', 'confirmed'],
    ['fact', 'disputed'],
    ['fact', 'superseded'],
    ['blocker', 'done'],
  ])('refuses to start a %s as %s', (kind, status) => {
    expect(chooseInitialStatus(kind, 'user', status)).toBeNull();
  });

  it.each<[MemoryKind, MemoryStatus]>([
    ['fact', 'confirmed'],
    ['task', 'done'],
  ])('does not let an extracted %s start as %s', (kind, status) => {
    expect(chooseInitialStatus(kind, 'extracted', status)).toBeNull();
  });

  it('lets an extracted item ask for its own default', () => {
    expect(chooseInitialStatus('fact', 'extracted', 'proposed')).toBe('proposed');
  });
});

describe('canTransition', () => {
  it.each<[MemoryKind, MemoryStatus, MemoryStatus]>([
    ['fact', 'proposed', 'confirmed'],
    ['hypothesis', 'rejected', 'proposed'],
    ['task', 'done', 'open'],
  ])('allows a %s to go from %s to %s', (kind, from, to) => {
    expect(canTransition(kind, from, to)).toBe(true);
  });

  it.each<[MemoryKind, MemoryStatus, MemoryStatus]>([
    ['fact', 'disputed', 'confirmed'],
    ['fact', 'superseded', 'confirmed'],
    ['fact', 'confirmed', 'disputed'],
    ['task', 'open', 'confirmed'],
  ])('refuses to move a %s from %s to %s', (kind, from, to) => {
    expect(canTransition(kind, from, to)).toBe(false);
  });
});