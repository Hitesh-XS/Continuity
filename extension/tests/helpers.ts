import Dexie from 'dexie';
import { createDb, type ContinuityDb } from '../src/storage/db';

export function openTestDb(): { db: ContinuityDb; cleanup: () => Promise<void> } {
  const name = `continuity-test-${crypto.randomUUID()}`;
  const db = createDb(name);
  return {
    db,
    cleanup: async () => {
      db.close();
      await Dexie.delete(name);
    },
  };
}

/** A clock that moves forward one second per call, so ordering is deterministic. */
export function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString();
}