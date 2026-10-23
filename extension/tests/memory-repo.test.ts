import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCaptureStore } from '../src/capture/ingest';
import {
  DuplicateMemoryError,
  InvalidMemoryOperationError,
  MemoryEvidenceNotFoundError,
  MemoryItemNotFoundError,
  MemoryLimitError,
  MemoryProjectNotFoundError,
  MemoryValidationError,
  createMemoryRepository,
} from '../src/memory/repository';
import type { ContinuityDb } from '../src/storage/db';
import { createProjectRepository } from '../src/storage/projects';
import { openTestDb, tickingClock } from './helpers';

let db: ContinuityDb;
let cleanup: () => Promise<void>;
let repo: ReturnType<typeof createMemoryRepository>;
let projects: ReturnType<typeof createProjectRepository>;
let capture: ReturnType<typeof createCaptureStore>;
let projectId: string;

beforeEach(async () => {
  ({ db, cleanup } = openTestDb());
  const clock = tickingClock();
  repo = createMemoryRepository(db, { now: clock, maxItems: 8, maxEvidence: 2 });
  projects = createProjectRepository(db, { now: clock });
  capture = createCaptureStore(db, { now: clock });
  projectId = (await projects.create({ name: 'P' })).id;
});

afterEach(async () => {
  await cleanup();
});

/** Conversation "claude:abc" with messages claude:abc#o0, #o1, ... */
async function seedMessages(texts: string[] = ['first message', 'second message']): Promise<void> {
  await capture.ingest(
    {
      externalConversationId: 'abc',
      title: 'Chat',
      messages: texts.map((text, index) => ({
        index,
        role: index % 2 === 0 ? 'user' : 'assistant',
        text,
      })),
    },
    { providerId: 'claude', projectId },
  );
}

const actions = async (id: string): Promise<string[]> =>
  (await repo.history(id)).map((entry) => entry.action);

describe('memory repository: create', () => {
  it('creates a confirmed fact for a user, trimmed, with a history entry', async () => {
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: '  The API uses JWT  ',
      topic: ' auth ',
    });
    expect(item).toMatchObject({
      projectId,
      kind: 'fact',
      text: 'The API uses JWT',
      topic: 'auth',
      status: 'confirmed',
      origin: 'user',
      evidence: [],
      conflictsWith: [],
      supersededById: null,
      supersedesId: null,
      schemaVersion: 1,
    });
    const history = await repo.history(item.id);
    expect(history.map((entry) => entry.action)).toEqual(['created']);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'confirmed' });
  });

  it('starts preferences confirmed, hypotheses proposed, tasks and blockers open', async () => {
    const statuses: string[] = [];
    for (const kind of ['preference', 'hypothesis', 'task', 'blocker'] as const) {
      statuses.push((await repo.create(projectId, { kind, text: `a ${kind}` })).status);
    }
    expect(statuses).toEqual(['confirmed', 'proposed', 'open', 'open']);
  });

  it('starts extracted items as proposed or open, never confirmed', async () => {
    const fact = await repo.create(projectId, { kind: 'fact', text: 'Maybe X' }, { origin: 'extracted' });
    const task = await repo.create(projectId, { kind: 'task', text: 'Do Y' }, { origin: 'extracted' });
    expect([fact.status, fact.origin, task.status]).toEqual(['proposed', 'extracted', 'open']);
  });

  it('refuses an extracted item that asks to start confirmed, and stores nothing', async () => {
    const error = await repo
      .create(projectId, { kind: 'fact', text: 'x', status: 'confirmed' }, { origin: 'extracted' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(MemoryValidationError);
    expect((error as MemoryValidationError).fields).toEqual(['status']);
    expect(await db.memoryItems.count()).toBe(0);
  });

  it.each<[string, unknown]>([
    ['blank text', { kind: 'fact', text: '   ' }],
    ['text that is too long', { kind: 'fact', text: 'x'.repeat(1001) }],
    ['an unknown kind', { kind: 'rumour', text: 'x' }],
  ])('rejects %s and stores nothing', async (_label, input) => {
    await expect(repo.create(projectId, input)).rejects.toBeInstanceOf(MemoryValidationError);
    expect(await db.memoryItems.count()).toBe(0);
  });

  it('rejects an unknown project', async () => {
    await expect(
      repo.create(crypto.randomUUID(), { kind: 'fact', text: 'x' }),
    ).rejects.toBeInstanceOf(MemoryProjectNotFoundError);
  });

  it('refuses items beyond the per-project limit', async () => {
    for (let i = 0; i < 8; i += 1) await repo.create(projectId, { kind: 'task', text: `task ${i}` });
    await expect(repo.create(projectId, { kind: 'task', text: 'one too many' })).rejects.toBeInstanceOf(
      MemoryLimitError,
    );
    expect(await db.memoryItems.count()).toBe(8);
  });

  it('computes evidence references from the stored messages', async () => {
    await seedMessages();
    const message = await db.messages.get('claude:abc#o0');
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: 'x',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    expect(item.evidence).toHaveLength(1);
    expect(item.evidence[0]).toMatchObject({
      conversationId: 'claude:abc',
      messageId: 'claude:abc#o0',
      contentHash: message?.contentHash,
    });
  });

  it('rejects evidence that does not exist and stores nothing', async () => {
    const error = await repo
      .create(projectId, { kind: 'fact', text: 'x', evidenceMessageIds: ['claude:abc#o9'] })
      .catch((e) => e);
    expect(error).toBeInstanceOf(MemoryEvidenceNotFoundError);
    expect(await db.memoryItems.count()).toBe(0);
  });

  it('never copies message text into memory', async () => {
    await seedMessages(['SECRET-TEXT-12345', 'other']);
    await repo.create(projectId, {
      kind: 'fact',
      text: 'A fact I wrote',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    const everything = JSON.stringify([
      await db.memoryItems.toArray(),
      await db.memoryHistory.toArray(),
    ]);
    expect(everything).not.toContain('SECRET-TEXT-12345');
  });

  it('links a message once even if it is listed twice', async () => {
    await seedMessages();
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: 'x',
      evidenceMessageIds: ['claude:abc#o0', 'claude:abc#o0'],
    });
    expect(item.evidence).toHaveLength(1);
  });
});

describe('memory repository: conflicts', () => {
  const decision = (text: string, topic: string) => ({ kind: 'decision', text, topic });

  it('flags two live items on the same topic with different text as disputed', async () => {
    const a = await repo.create(projectId, decision('Use PostgreSQL', 'database'));
    const b = await repo.create(projectId, decision('Use SQLite', 'Database'));
    expect(await repo.get(a.id)).toMatchObject({ status: 'disputed', conflictsWith: [b.id] });
    expect(await repo.get(b.id)).toMatchObject({ status: 'disputed', conflictsWith: [a.id] });
    expect(await actions(a.id)).toEqual(['created', 'conflict_flagged']);
  });

  it('refuses a duplicate on the same topic, ignoring case and spacing', async () => {
    await repo.create(projectId, { kind: 'fact', text: 'Uses JWT', topic: 'auth' });
    await expect(
      repo.create(projectId, { kind: 'fact', text: '  uses   jwt ', topic: 'AUTH' }),
    ).rejects.toBeInstanceOf(DuplicateMemoryError);
    expect(await db.memoryItems.count()).toBe(1);
  });

  it('does not compare items that have no topic', async () => {
    await repo.create(projectId, { kind: 'fact', text: 'One' });
    const second = await repo.create(projectId, { kind: 'fact', text: 'Two' });
    expect(second.status).toBe('confirmed');
  });

  it('does not compare different kinds on the same topic', async () => {
    await repo.create(projectId, { kind: 'fact', text: 'The DB is Postgres', topic: 'database' });
    const other = await repo.create(projectId, decision('Use SQLite', 'database'));
    expect(other.status).toBe('confirmed');
  });

  it('does not compare items across projects', async () => {
    const other = await projects.create({ name: 'Q' });
    await repo.create(projectId, { kind: 'fact', text: 'A', topic: 'x' });
    const b = await repo.create(other.id, { kind: 'fact', text: 'B', topic: 'x' });
    expect(b.status).toBe('confirmed');
  });

  it('puts a third conflicting item in the same group', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    const b = await repo.create(projectId, { kind: 'fact', text: 'B', topic: 't' });
    const c = await repo.create(projectId, { kind: 'fact', text: 'C', topic: 't' });
    const [sa, sb, sc] = await Promise.all([repo.get(a.id), repo.get(b.id), repo.get(c.id)]);
    expect([sa?.status, sb?.status, sc?.status]).toEqual(['disputed', 'disputed', 'disputed']);
    expect(new Set(sa?.conflictsWith)).toEqual(new Set([b.id, c.id]));
    expect(new Set(sb?.conflictsWith)).toEqual(new Set([a.id, c.id]));
    expect(new Set(sc?.conflictsWith)).toEqual(new Set([a.id, b.id]));
  });

  it('keeps the winner and supersedes the others when a conflict is resolved', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    const b = await repo.create(projectId, { kind: 'fact', text: 'B', topic: 't' });
    const c = await repo.create(projectId, { kind: 'fact', text: 'C', topic: 't' });
    const winner = await repo.resolveConflict(b.id);
    expect(winner).toMatchObject({ status: 'confirmed', conflictsWith: [] });
    for (const id of [a.id, c.id]) {
      expect(await repo.get(id)).toMatchObject({
        status: 'superseded',
        supersededById: b.id,
        conflictsWith: [],
      });
    }
    expect(await actions(a.id)).toContain('conflict_resolved');
  });

  it('refuses to resolve an item that is not disputed', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    await expect(repo.resolveConflict(a.id)).rejects.toBeInstanceOf(InvalidMemoryOperationError);
  });

  it('forces a conflict to be resolved before the status can change', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    await repo.create(projectId, { kind: 'fact', text: 'B', topic: 't' });
    await expect(repo.setStatus(a.id, 'proposed')).rejects.toBeInstanceOf(InvalidMemoryOperationError);
  });

  it('returns the other side of a conflict to proposed when one side is deleted', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    const b = await repo.create(projectId, { kind: 'fact', text: 'B', topic: 't' });
    await repo.remove(b.id);
    expect(await repo.get(a.id)).toMatchObject({ status: 'proposed', conflictsWith: [] });
  });

  it('clears a conflict when an edit moves an item to another topic', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    const b = await repo.create(projectId, { kind: 'fact', text: 'B', topic: 't' });
    const edited = await repo.update(b.id, { topic: 'something else' });
    expect(edited).toMatchObject({ status: 'proposed', conflictsWith: [] });
    expect(await repo.get(a.id)).toMatchObject({ status: 'proposed', conflictsWith: [] });
  });

  it('refuses an edit that would duplicate another live item and keeps the old text', async () => {
    await repo.create(projectId, { kind: 'fact', text: 'Uses JWT', topic: 'auth' });
    const b = await repo.create(projectId, { kind: 'fact', text: 'Uses sessions', topic: 'auth' });
    await expect(repo.update(b.id, { text: 'uses jwt' })).rejects.toBeInstanceOf(DuplicateMemoryError);
    expect(await repo.get(b.id)).toMatchObject({ text: 'Uses sessions', status: 'disputed' });
  });

  it('does not treat superseded items as rivals', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'Uses JWT', topic: 'auth' });
    const { replacement } = await repo.supersede(a.id, { text: 'Uses OAuth' });
    const c = await repo.create(projectId, { kind: 'fact', text: 'uses jwt', topic: 'auth' });
    expect(c.conflictsWith).toEqual([replacement.id]);
  });
});

describe('memory repository: update', () => {
  it('records the previous text when an item is edited', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'Old' });
    const edited = await repo.update(item.id, { text: 'New' });
    expect(edited.text).toBe('New');
    const history = await repo.history(item.id);
    expect(history[history.length - 1]).toMatchObject({ action: 'edited', fromText: 'Old' });
  });

  it('does nothing when the edit changes nothing', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'Same' });
    expect(await repo.update(item.id, { text: 'Same' })).toEqual(item);
    expect(await repo.history(item.id)).toHaveLength(1);
  });

  it('rejects an empty patch', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await expect(repo.update(item.id, {})).rejects.toBeInstanceOf(MemoryValidationError);
  });

  it('rejects blank text', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await expect(repo.update(item.id, { text: '  ' })).rejects.toBeInstanceOf(MemoryValidationError);
  });

  it('treats superseded items as read-only', async () => {
    const old = await repo.create(projectId, { kind: 'fact', text: 'Old' });
    await repo.supersede(old.id, { text: 'Newer' });
    await expect(repo.update(old.id, { text: 'x' })).rejects.toBeInstanceOf(InvalidMemoryOperationError);
  });

  it('reports an unknown id', async () => {
    await expect(repo.update(crypto.randomUUID(), { text: 'x' })).rejects.toBeInstanceOf(
      MemoryItemNotFoundError,
    );
  });
});

describe('memory repository: status', () => {
  it('lets a user confirm a proposed item and records it', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'Maybe' }, { origin: 'extracted' });
    const confirmed = await repo.setStatus(item.id, 'confirmed');
    expect(confirmed.status).toBe('confirmed');
    const history = await repo.history(item.id);
    expect(history[history.length - 1]).toMatchObject({
      action: 'status_changed',
      fromStatus: 'proposed',
      toStatus: 'confirmed',
    });
  });

  it('moves a task between open and done', async () => {
    const task = await repo.create(projectId, { kind: 'task', text: 'Write tests' });
    expect((await repo.setStatus(task.id, 'done')).status).toBe('done');
    expect((await repo.setStatus(task.id, 'open')).status).toBe('open');
  });

  it('can reject a hypothesis', async () => {
    const hypothesis = await repo.create(projectId, { kind: 'hypothesis', text: 'It is the cache' });
    expect((await repo.setStatus(hypothesis.id, 'rejected')).status).toBe('rejected');
  });

  it('refuses a status that does not fit the kind', async () => {
    const fact = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await expect(repo.setStatus(fact.id, 'done')).rejects.toBeInstanceOf(InvalidMemoryOperationError);
  });

  it('refuses to set superseded or disputed directly', async () => {
    const fact = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await expect(repo.setStatus(fact.id, 'superseded')).rejects.toBeInstanceOf(
      InvalidMemoryOperationError,
    );
    await expect(repo.setStatus(fact.id, 'disputed')).rejects.toBeInstanceOf(
      InvalidMemoryOperationError,
    );
  });

  it('refuses to change the status of a superseded item', async () => {
    const old = await repo.create(projectId, { kind: 'fact', text: 'Old' });
    await repo.supersede(old.id, { text: 'Newer' });
    await expect(repo.setStatus(old.id, 'proposed')).rejects.toBeInstanceOf(InvalidMemoryOperationError);
  });
});

describe('memory repository: supersede', () => {
  it('replaces an item while keeping it as read-only history', async () => {
    const old = await repo.create(projectId, { kind: 'decision', text: 'Use REST' });
    const result = await repo.supersede(old.id, { text: 'Use GraphQL' });
    expect(result.old).toMatchObject({ status: 'superseded', supersededById: result.replacement.id });
    expect(result.replacement).toMatchObject({
      kind: 'decision',
      text: 'Use GraphQL',
      status: 'confirmed',
      supersedesId: old.id,
    });
    expect(await actions(old.id)).toEqual(['created', 'superseded']);
  });

  it('inherits kind and topic but not evidence', async () => {
    await seedMessages();
    const old = await repo.create(projectId, {
      kind: 'fact',
      text: 'v1',
      topic: 'api',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    const { replacement } = await repo.supersede(old.id, { text: 'v2' });
    expect(replacement).toMatchObject({ kind: 'fact', topic: 'api', evidence: [] });
  });

  it('releases the other side of a conflict when a disputed item is replaced', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A', topic: 't' });
    const b = await repo.create(projectId, { kind: 'fact', text: 'B', topic: 't' });
    const { replacement } = await repo.supersede(a.id, { text: 'A2', topic: 'other' });
    expect(replacement.status).toBe('confirmed');
    expect(await repo.get(b.id)).toMatchObject({ status: 'proposed', conflictsWith: [] });
  });

  it('refuses to replace an item twice', async () => {
    const old = await repo.create(projectId, { kind: 'fact', text: 'Old' });
    await repo.supersede(old.id, { text: 'Newer' });
    await expect(repo.supersede(old.id, { text: 'Again' })).rejects.toBeInstanceOf(
      InvalidMemoryOperationError,
    );
  });

  it('rolls everything back when the replacement would duplicate a live item', async () => {
    await repo.create(projectId, { kind: 'fact', text: 'Uses JWT', topic: 'auth' });
    const other = await repo.create(projectId, { kind: 'fact', text: 'Tabs', topic: 'style' });
    await expect(
      repo.supersede(other.id, { text: 'uses jwt', topic: 'auth' }),
    ).rejects.toBeInstanceOf(DuplicateMemoryError);
    expect(await repo.get(other.id)).toMatchObject({ status: 'confirmed', supersededById: null });
    expect(await db.memoryItems.count()).toBe(2);
  });
});

describe('memory repository: evidence', () => {
  it('links a message once and ignores repeats', async () => {
    await seedMessages();
    const item = await repo.create(projectId, { kind: 'fact', text: 'x' });
    const first = await repo.addEvidence(item.id, 'claude:abc#o0');
    const again = await repo.addEvidence(item.id, 'claude:abc#o0');
    expect(first.evidence).toHaveLength(1);
    expect(again.evidence).toHaveLength(1);
    expect((await actions(item.id)).filter((action) => action === 'evidence_added')).toHaveLength(1);
  });

  it('rejects a message that is not stored', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await expect(repo.addEvidence(item.id, 'claude:abc#o9')).rejects.toBeInstanceOf(
      MemoryEvidenceNotFoundError,
    );
  });

  it('refuses more linked messages than the limit', async () => {
    await seedMessages(['a', 'b', 'c']);
    const item = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await repo.addEvidence(item.id, 'claude:abc#o0');
    await repo.addEvidence(item.id, 'claude:abc#o1');
    await expect(repo.addEvidence(item.id, 'claude:abc#o2')).rejects.toBeInstanceOf(MemoryLimitError);
  });

  it('removes a link and records it', async () => {
    await seedMessages();
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: 'x',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    const result = await repo.removeEvidence(item.id, 'claude:abc#o0');
    expect(result.evidence).toEqual([]);
    expect(await actions(item.id)).toContain('evidence_removed');
  });

  it('reports unchanged evidence as ok', async () => {
    await seedMessages();
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: 'x',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    const [view] = await repo.inspectEvidence(item.id);
    expect(view?.state).toBe('ok');
    expect(view?.message?.text).toBe('first message');
  });

  it('reports evidence whose message text changed after it was linked', async () => {
    await seedMessages();
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: 'x',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    await capture.ingest(
      { externalConversationId: 'abc', messages: [{ index: 0, role: 'user', text: 'edited' }] },
      { providerId: 'claude', projectId },
    );
    const [view] = await repo.inspectEvidence(item.id);
    expect(view?.state).toBe('changed');
    expect(view?.message?.text).toBe('edited');
  });

  it('reports evidence whose message was deleted', async () => {
    await seedMessages();
    const item = await repo.create(projectId, {
      kind: 'fact',
      text: 'x',
      evidenceMessageIds: ['claude:abc#o0'],
    });
    await db.messages.delete('claude:abc#o0');
    const [view] = await repo.inspectEvidence(item.id);
    expect(view?.state).toBe('missing');
    expect(view?.message).toBeNull();
  });
});

describe('memory repository: listing, history and deletion', () => {
  it('lists items oldest first and filters by kind or status', async () => {
    const a = await repo.create(projectId, { kind: 'fact', text: 'A' });
    const b = await repo.create(projectId, { kind: 'task', text: 'B' });
    const c = await repo.create(projectId, { kind: 'fact', text: 'C' });
    await repo.setStatus(b.id, 'done');
    expect((await repo.list(projectId)).map((item) => item.id)).toEqual([a.id, b.id, c.id]);
    expect((await repo.list(projectId, { kinds: ['fact'] })).map((item) => item.id)).toEqual([a.id, c.id]);
    expect((await repo.list(projectId, { statuses: ['done'] })).map((item) => item.id)).toEqual([b.id]);
  });

  it('keeps projects separate', async () => {
    const other = await projects.create({ name: 'Q' });
    await repo.create(projectId, { kind: 'fact', text: 'A' });
    await repo.create(other.id, { kind: 'fact', text: 'B' });
    expect(await repo.list(projectId)).toHaveLength(1);
    expect(await repo.list(other.id)).toHaveLength(1);
  });

  it('returns history oldest first across several operations', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'Old' });
    await repo.update(item.id, { text: 'New' });
    await repo.setStatus(item.id, 'proposed');
    expect(await actions(item.id)).toEqual(['created', 'edited', 'status_changed']);
  });

  it('removes an item together with its history', async () => {
    const item = await repo.create(projectId, { kind: 'fact', text: 'x' });
    await repo.remove(item.id);
    expect(await repo.get(item.id)).toBeUndefined();
    expect(await db.memoryHistory.count()).toBe(0);
  });

  it('forgets supersede links when the other item is deleted', async () => {
    const old = await repo.create(projectId, { kind: 'fact', text: 'Old' });
    const { replacement } = await repo.supersede(old.id, { text: 'Newer' });
    await repo.remove(replacement.id);
    expect(await repo.get(old.id)).toMatchObject({ status: 'superseded', supersededById: null });
  });

  it('treats removing a missing item as a no-op', async () => {
    await expect(repo.remove(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('removes all memory of one project only', async () => {
    const other = await projects.create({ name: 'Q' });
    await repo.create(projectId, { kind: 'fact', text: 'A' });
    await repo.create(other.id, { kind: 'fact', text: 'B' });
    await repo.removeAllForProject(projectId);
    expect(await repo.list(projectId)).toEqual([]);
    expect(await repo.list(other.id)).toHaveLength(1);
    expect(await db.memoryHistory.where('projectId').equals(projectId).count()).toBe(0);
  });

  it('is deleted along with its project', async () => {
    await repo.create(projectId, { kind: 'fact', text: 'A' });
    await projects.remove(projectId);
    expect(await db.memoryItems.count()).toBe(0);
    expect(await db.memoryHistory.count()).toBe(0);
  });

  it('returns undefined for an unknown id', async () => {
    expect(await repo.get(crypto.randomUUID())).toBeUndefined();
  });
});