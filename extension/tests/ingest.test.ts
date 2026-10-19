import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversationIdFor, createCaptureStore } from '../src/capture/ingest';
import type { Snapshot } from '../src/capture/snapshot';
import type { ContinuityDb } from '../src/storage/db';
import { openTestDb, tickingClock } from './helpers';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ctx = { providerId: 'claude' as const, projectId: null as string | null };

function snap(messages: Snapshot['messages'], extra: Partial<Snapshot> = {}): Snapshot {
  return { externalConversationId: 'abc', messages, ...extra };
}

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let store: ReturnType<typeof createCaptureStore>;

beforeEach(() => {
  ({ db, cleanup } = openTestDb());
  store = createCaptureStore(db, { now: tickingClock() });
});

afterEach(async () => {
  await cleanup();
});

async function allMessages() {
  return (await db.messages.toArray()).sort((a, b) => a.ordinal - b.ordinal);
}

describe('capture ingestion', () => {
  it('creates the conversation and its messages', async () => {
    const result = await store.ingest(
      snap(
        [
          { role: 'user', text: 'Hi' },
          { role: 'assistant', text: 'Hello!' },
        ],
        { title: 'Greeting' },
      ),
      ctx,
    );
    expect(result).toEqual({ conversationId: 'claude:abc', inserted: 2, updated: 0, unchanged: 0 });
    expect(await db.conversations.get('claude:abc')).toMatchObject({
      providerId: 'claude',
      externalId: 'abc',
      title: 'Greeting',
      projectId: null,
      messageCount: 2,
    });
    const messages = await allMessages();
    expect(messages.map((m) => m.text)).toEqual(['Hi', 'Hello!']);
    expect(messages.map((m) => m.revision)).toEqual([1, 1]);
  });

  it('changes nothing when the same snapshot arrives again', async () => {
    const snapshot = snap([
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello!' },
    ]);
    await store.ingest(snapshot, ctx);
    const first = await db.conversations.get('claude:abc');
    const second = await store.ingest(snapshot, ctx);
    const after = await db.conversations.get('claude:abc');

    expect(second).toEqual({ conversationId: 'claude:abc', inserted: 0, updated: 0, unchanged: 2 });
    expect(await db.messages.count()).toBe(2);
    expect(after?.updatedAt).toBe(first?.updatedAt); // content did not change
    expect(after!.lastCapturedAt > first!.lastCapturedAt).toBe(true); // but we did look again
  });

  it('updates a changed message in place and bumps its revision', async () => {
    await store.ingest(
      snap([
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hel' },
      ]),
      ctx,
    );
    const result = await store.ingest(
      snap([
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello there' },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await db.messages.count()).toBe(2);
    const messages = await allMessages();
    expect(messages[1]).toMatchObject({ text: 'Hello there', revision: 2 });
    expect(messages[0]).toMatchObject({ text: 'Hi', revision: 1 });
  });

  it('appends new messages', async () => {
    await store.ingest(snap([{ role: 'user', text: 'Hi' }]), ctx);
    const result = await store.ingest(
      snap([
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello' },
        { role: 'user', text: 'Thanks' },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ inserted: 2, updated: 0, unchanged: 1 });
    expect((await db.conversations.get('claude:abc'))?.messageCount).toBe(3);
  });

  it('keeps keyed messages stable when the list shifts', async () => {
    await store.ingest(
      snap([
        { key: 'a', role: 'user', text: 'A' },
        { key: 'b', role: 'assistant', text: 'B' },
      ]),
      ctx,
    );
    const result = await store.ingest(
      snap([
        { key: 'z', role: 'user', text: 'Z' },
        { key: 'a', role: 'user', text: 'A' },
        { key: 'b', role: 'assistant', text: 'B' },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ inserted: 1, updated: 0, unchanged: 2 });
    expect(await db.messages.get('claude:abc#a')).toMatchObject({ ordinal: 1, revision: 1 });
    expect(await db.messages.get('claude:abc#b')).toMatchObject({ ordinal: 2, revision: 1 });
  });

  it('assigns the project when the conversation is created and never reassigns it', async () => {
    await store.ingest(snap([{ role: 'user', text: 'Hi' }]), { ...ctx, projectId: PROJECT });
    await store.ingest(snap([{ role: 'user', text: 'Hi again' }]), { ...ctx, projectId: null });
    expect((await db.conversations.get('claude:abc'))?.projectId).toBe(PROJECT);
  });

  it('keeps the old title when a snapshot has none, and updates it when one arrives', async () => {
    const messages: Snapshot['messages'] = [{ role: 'user', text: 'Hi' }];
    await store.ingest(snap(messages, { title: 'First' }), ctx);
    await store.ingest(snap(messages), ctx);
    expect((await db.conversations.get('claude:abc'))?.title).toBe('First');
    await store.ingest(snap(messages, { title: 'Second' }), ctx);
    expect((await db.conversations.get('claude:abc'))?.title).toBe('Second');
  });

  it('keeps messages that are missing from a later snapshot', async () => {
    await store.ingest(
      snap([
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' },
        { role: 'user', text: 'three' },
      ]),
      ctx,
    );
    await store.ingest(
      snap([
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' },
      ]),
      ctx,
    );
    expect(await db.messages.count()).toBe(3);
    expect((await db.conversations.get('claude:abc'))?.messageCount).toBe(3);
  });

  it('treats a role change as an update', async () => {
    await store.ingest(snap([{ role: 'user', text: 'same text' }]), ctx);
    const result = await store.ingest(snap([{ role: 'assistant', text: 'same text' }]), ctx);
    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    expect((await allMessages())[0]?.role).toBe('assistant');
  });

  it('builds deterministic conversation ids', () => {
    expect(conversationIdFor('claude', 'abc')).toBe('claude:abc');
  });

  it('keeps separate conversations separate', async () => {
    await store.ingest(snap([{ role: 'user', text: 'one' }]), ctx);
    await store.ingest(
      { externalConversationId: 'xyz', messages: [{ role: 'user', text: 'one' }] },
      ctx,
    );
    expect(await db.conversations.count()).toBe(2);
    expect(await db.messages.count()).toBe(2);
  });

  it('documents the limitation: inserting into an UNKEYED list shifts later positions', async () => {
    await store.ingest(
      snap([
        { role: 'user', text: 'A' },
        { role: 'assistant', text: 'B' },
      ]),
      ctx,
    );
    const result = await store.ingest(
      snap([
        { role: 'user', text: 'X' },
        { role: 'user', text: 'A' },
        { role: 'assistant', text: 'B' },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ inserted: 1, updated: 2, unchanged: 0 });
  });
});
const msg = (index: number, role: 'user' | 'assistant', text: string) => ({ index, role, text });

describe('capture ingestion: absolute page indexes', () => {
  it('keeps page indexes as ordinals when a later snapshot covers only a window', async () => {
    await store.ingest(
      snap([msg(0, 'user', 'm0'), msg(1, 'assistant', 'm1'), msg(2, 'user', 'm2'), msg(3, 'assistant', 'm3')]),
      ctx,
    );
    const result = await store.ingest(
      snap([msg(2, 'user', 'm2'), msg(3, 'assistant', 'm3 edited'), msg(4, 'user', 'm4')]),
      ctx,
    );
    expect(result).toMatchObject({ inserted: 1, updated: 1, unchanged: 1 });
    const stored = await allMessages();
    expect(stored.map((m) => [m.ordinal, m.text])).toEqual([
      [0, 'm0'],
      [1, 'm1'],
      [2, 'm2'],
      [3, 'm3 edited'],
      [4, 'm4'],
    ]);
    expect((await db.conversations.get('claude:abc'))?.messageCount).toBe(5);
  });

  it('derives the message key from the page index', async () => {
    await store.ingest(snap([msg(7, 'user', 'x')]), ctx);
    expect(await db.messages.get('claude:abc#o7')).toMatchObject({ ordinal: 7, text: 'x' });
  });
});