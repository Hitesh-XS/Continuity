import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import {
  DuplicateMemoryError,
  InvalidMemoryOperationError,
  MemoryEvidenceNotFoundError,
  MemoryItemNotFoundError,
  MemoryLimitError,
  MemoryValidationError,
  type EvidenceView,
} from '../../src/memory/repository';
import type { LocalMemoryItem, MemoryHistoryEntry } from '../../src/memory/types';
import { memoryRepo } from './services';

/** Re-renders whenever the data the query reads changes. `key` identifies what is being read. */
function useLive<T>(key: string | null, query: () => Promise<T>): T | null {
  const [value, setValue] = useState<{ key: string; data: T } | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    const subscription = liveQuery(query).subscribe({
      next: (data) => setValue({ key, data }),
      error: (e) => console.error('Continuity: live query failed', e instanceof Error ? e.name : 'Error'),
    });
    return () => subscription.unsubscribe();
    // The query closes over the same value `key` encodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value !== null && value.key === key ? value.data : null;
}

export function useMemoryItems(projectId: string | null): LocalMemoryItem[] | null {
  return useLive(projectId ? `items:${projectId}` : null, () => memoryRepo.list(projectId ?? ''));
}

export function useMemoryHistory(itemId: string | null): MemoryHistoryEntry[] | null {
  return useLive(itemId ? `history:${itemId}` : null, () => memoryRepo.history(itemId ?? ''));
}

export function useMemoryEvidence(itemId: string | null): EvidenceView[] | null {
  return useLive(itemId ? `evidence:${itemId}` : null, () =>
    memoryRepo.inspectEvidence(itemId ?? '').catch(() => []),
  );
}

export function describeMemoryError(error: unknown): string {
  if (error instanceof DuplicateMemoryError) return error.message;
  if (error instanceof MemoryValidationError) {
    return `Please check: ${[...new Set(error.fields)].join(', ')}. Text is required (up to 1000 characters).`;
  }
  if (error instanceof MemoryLimitError) return error.message;
  if (error instanceof InvalidMemoryOperationError) return error.message;
  if (error instanceof MemoryEvidenceNotFoundError) {
    return 'That message is no longer stored in this browser.';
  }
  if (error instanceof MemoryItemNotFoundError) return 'That item no longer exists.';
  console.error('Continuity: memory operation failed', error instanceof Error ? error.name : 'Error');
  return 'Could not save to this browser. Your change was not stored.';
}