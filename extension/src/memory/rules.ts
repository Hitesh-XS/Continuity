import type { MemoryKind, MemoryOrigin, MemoryStatus } from './types';

/** Kinds that can contradict each other. */
export const CONFLICT_KINDS: readonly MemoryKind[] = ['fact', 'preference', 'decision'];

/** Statuses that take part in conflict checks. Superseded and closed items never do. */
export const LIVE_STATUSES: readonly MemoryStatus[] = ['proposed', 'confirmed', 'disputed'];

const USER_DEFAULT: Record<MemoryKind, MemoryStatus> = {
  fact: 'confirmed',
  preference: 'confirmed',
  decision: 'confirmed',
  hypothesis: 'proposed',
  task: 'open',
  blocker: 'open',
};

const EXTRACTED_DEFAULT: Record<MemoryKind, MemoryStatus> = {
  fact: 'proposed',
  preference: 'proposed',
  decision: 'proposed',
  hypothesis: 'proposed',
  task: 'open',
  blocker: 'open',
};

/** Statuses a user may pick for a kind. 'disputed' and 'superseded' are set only by the system. */
export const SETTABLE: Record<MemoryKind, readonly MemoryStatus[]> = {
  fact: ['proposed', 'confirmed'],
  preference: ['proposed', 'confirmed'],
  decision: ['proposed', 'confirmed'],
  hypothesis: ['proposed', 'confirmed', 'rejected'],
  task: ['open', 'done'],
  blocker: ['open', 'resolved'],
};

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The status a new item starts with, or null when the request is not allowed. */
export function chooseInitialStatus(
  kind: MemoryKind,
  origin: MemoryOrigin,
  requested?: MemoryStatus,
): MemoryStatus | null {
  const fallback = origin === 'extracted' ? EXTRACTED_DEFAULT[kind] : USER_DEFAULT[kind];
  if (requested === undefined) return fallback;
  if (origin === 'extracted') return requested === fallback ? fallback : null;
  return SETTABLE[kind].includes(requested) ? requested : null;
}

export function canTransition(kind: MemoryKind, from: MemoryStatus, to: MemoryStatus): boolean {
  return SETTABLE[kind].includes(from) && SETTABLE[kind].includes(to);
}