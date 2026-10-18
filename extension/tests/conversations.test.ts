import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversationRepository } from '../src/capture/conversations';
import { createCaptureStore } from '../src/capture/ingest';
import type { Snapshot } from '../src/capture/snapshot';
import { PROJECT_SCHEMA_VERSION, type ContinuityDb } from '../src/storage/db';
import { openTestDb, tickingClock } from './helpers';

const PROJECT = '11111111-1111-4111-8111-111111111111';

function snap(id: string, texts: string[]): Snapshot {
  return {
    externalConversationId: id,
    messages: texts.map((text, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text })),
  };
}

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let store: ReturnType<typeof createCaptureStore>;
let repo: ReturnType<typeof createConversationRepository>;

beforeEach(() => {
  ({ db, cleanup } = openTestDb());
  store = createCaptureStore(db, { now: tickingClock() });
  repo = createConversationRepository(db);
});

afterEach(async () => {
  await cleanup();
});

const ctx = (projectId: string | null) => ({ providerId: 'claude' as const, projectId });

describe('conversation repository', () => {
  it('lists conversations by most recent content change', async () => {
    await store.ingest(snap('a', ['one']), ctx(null));
    await store.ingest(snap('b', ['one']), ctx(null));
    await store.ingest(snap('a', ['one', 'two']), ctx(null)); // a changes last
    expect((await repo.list()).map((c) => c.externalId)).toEqual(['a', 'b']);
  });

  it('filters by project, including unassigned conversations', async () => {
    await store.ingest(snap('a', ['one']), ctx(PROJECT));
    await store.ingest(snap('b', ['one']), ctx(null));
    expect((await repo.list({ projectId: PROJECT })).map((c) => c.externalId)).toEqual(['a']);
    expect((await repo.list({ projectId: null })).map((c) => c.externalId)).toEqual(['b']);
  });

  it('returns messages in conversation order', async () => {
    await store.ingest(snap('a', ['first', 'second', 'third']), ctx(null));
    const messages = await repo.getMessages('claude:a');
    expect(messages.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  it('removes one conversation and only its messages', async () => {
    await store.ingest(snap('a', ['one', 'two']), ctx(null));
    await store.ingest(snap('b', ['one']), ctx(null));
    await repo.remove('claude:a');
    expect(await repo.get('claude:a')).toBeUndefined();
    expect(await repo.getMessages('claude:a')).toEqual([]);
    expect((await repo.getMessages('claude:b')).length).toBe(1);
  });

  it('removes everything captured but leaves projects alone', async () => {
    await db.projects.add({
      id: PROJECT,
      name: 'Keep me',
      description: '',
      currentGoal: '',
      status: 'active',
      syncMode: 'metadata_only',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: PROJECT_SCHEMA_VERSION,
    });
    await store.ingest(snap('a', ['one']), ctx(PROJECT));
    await repo.removeAll();
    expect(await db.conversations.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
    expect(await db.projects.count()).toBe(1);
  });

  it('returns undefined for a conversation that does not exist', async () => {
    expect(await repo.get('claude:nope')).toBeUndefined();
  });
});