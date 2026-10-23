import type { z } from 'zod';
import type { ContinuityDb, LocalMessage } from '../storage/db';
import {
  CONFLICT_KINDS,
  LIVE_STATUSES,
  canTransition,
  chooseInitialStatus,
  normalizeText,
} from './rules';
import {
  CreateMemoryInputSchema,
  MAX_EVIDENCE,
  SupersedeInputSchema,
  UpdateMemoryInputSchema,
} from './schema';
import {
  MEMORY_SCHEMA_VERSION,
  type EvidenceRef,
  type LocalMemoryItem,
  type MemoryHistoryAction,
  type MemoryHistoryEntry,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryStatus,
} from './types';

export class MemoryValidationError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Invalid memory field(s): ${fields.join(', ')}`);
    this.name = 'MemoryValidationError';
    this.fields = fields;
  }
}
export class MemoryProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = 'MemoryProjectNotFoundError';
  }
}
export class MemoryItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Memory item not found: ${id}`);
    this.name = 'MemoryItemNotFoundError';
  }
}
export class MemoryEvidenceNotFoundError extends Error {
  constructor(id: string) {
    super(`Message not found: ${id}`);
    this.name = 'MemoryEvidenceNotFoundError';
  }
}
export class DuplicateMemoryError extends Error {
  constructor() {
    super('An identical item already exists for this topic.');
    this.name = 'DuplicateMemoryError';
  }
}
/** The message is always one of our own fixed strings, so it is safe to show to the user. */
export class InvalidMemoryOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMemoryOperationError';
  }
}
export class MemoryLimitError extends Error {
  constructor(what: 'items' | 'evidence') {
    super(
      what === 'items'
        ? 'This project has reached the limit of memory items.'
        : 'This item has reached the limit of linked messages.',
    );
    this.name = 'MemoryLimitError';
  }
}

function fieldNames(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join('.') || 'input');
}

export type EvidenceState = 'ok' | 'changed' | 'missing';
export interface EvidenceView {
  ref: EvidenceRef;
  state: EvidenceState;
  /** The message as it is stored NOW (which may differ from when it was linked). */
  message: LocalMessage | null;
}

export interface MemoryRepositoryOptions {
  now?: () => string;
  newId?: () => string;
  maxItems?: number;
  maxEvidence?: number;
}

export function createMemoryRepository(db: ContinuityDb, options: MemoryRepositoryOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const maxItems = options.maxItems ?? 2000;
  const maxEvidence = options.maxEvidence ?? MAX_EVIDENCE;
  let sequence = 0;

  const tables = [db.memoryItems, db.memoryHistory, db.messages, db.projects];
  const inTx = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('rw', tables, fn);

  async function requireItem(id: string): Promise<LocalMemoryItem> {
    const item = await db.memoryItems.get(id);
    if (!item) throw new MemoryItemNotFoundError(id);
    return item;
  }

  function assertEditable(item: LocalMemoryItem): void {
    if (item.status === 'superseded') {
      throw new InvalidMemoryOperationError('Superseded items are read-only.');
    }
  }

  async function record(
    item: Pick<LocalMemoryItem, 'id' | 'projectId'>,
    at: string,
    action: MemoryHistoryAction,
    change: {
      fromStatus?: MemoryStatus | null;
      toStatus?: MemoryStatus | null;
      fromText?: string | null;
    } = {},
  ): Promise<void> {
    sequence += 1;
    await db.memoryHistory.add({
      id: newId(),
      itemId: item.id,
      projectId: item.projectId,
      n: sequence,
      at,
      action,
      fromStatus: change.fromStatus ?? null,
      toStatus: change.toStatus ?? null,
      fromText: change.fromText ?? null,
    });
  }

  async function buildEvidence(messageIds: string[], at: string): Promise<EvidenceRef[]> {
    const refs: EvidenceRef[] = [];
    for (const id of new Set(messageIds)) {
      const message = await db.messages.get(id);
      if (!message) throw new MemoryEvidenceNotFoundError(id);
      refs.push({
        conversationId: message.conversationId,
        messageId: message.id,
        contentHash: message.contentHash,
        linkedAt: at,
      });
    }
    if (refs.length > maxEvidence) throw new MemoryLimitError('evidence');
    return refs;
  }

  /**
   * Keeps conflict links honest: drops links to items that are no longer disputed (or no longer
   * exist), and returns a disputed item with no remaining conflict to "proposed".
   */
  async function repairConflicts(projectId: string, at: string): Promise<void> {
    for (let pass = 0; pass < 5; pass += 1) {
      const items = await db.memoryItems.where('projectId').equals(projectId).toArray();
      const disputed = new Set(items.filter((item) => item.status === 'disputed').map((i) => i.id));
      let changedAny = false;
      for (const item of items) {
        const kept = item.conflictsWith.filter((id) => id !== item.id && disputed.has(id));
        if (item.status === 'disputed' && kept.length === 0) {
          await db.memoryItems.put({ ...item, status: 'proposed', conflictsWith: [], updatedAt: at });
          await record(item, at, 'conflict_cleared', { fromStatus: 'disputed', toStatus: 'proposed' });
          changedAny = true;
        } else if (kept.length !== item.conflictsWith.length) {
          await db.memoryItems.put({ ...item, conflictsWith: kept, updatedAt: at });
          changedAny = true;
        }
      }
      if (!changedAny) return;
    }
  }

  /** The explicit conflict rule. Throws DuplicateMemoryError (rolling the transaction back) on a duplicate. */
  async function applyConflictRules(itemId: string, at: string): Promise<void> {
    const item = await db.memoryItems.get(itemId);
    if (
      !item ||
      item.topic === '' ||
      !CONFLICT_KINDS.includes(item.kind) ||
      !LIVE_STATUSES.includes(item.status)
    ) {
      return;
    }
    const topicKey = normalizeText(item.topic);
    const textKey = normalizeText(item.text);
    const sameProject = await db.memoryItems.where('projectId').equals(item.projectId).toArray();
    const rivals = sameProject.filter(
      (other) =>
        other.id !== item.id &&
        other.kind === item.kind &&
        LIVE_STATUSES.includes(other.status) &&
        normalizeText(other.topic) === topicKey,
    );
    if (rivals.some((other) => normalizeText(other.text) === textKey)) throw new DuplicateMemoryError();
    if (rivals.length === 0) return;

    const linked = new Set(item.conflictsWith);
    for (const rival of rivals) {
      linked.add(rival.id);
      await db.memoryItems.put({
        ...rival,
        status: 'disputed',
        conflictsWith: [...new Set([...rival.conflictsWith, item.id])],
        updatedAt: at,
      });
      if (rival.status !== 'disputed') {
        await record(rival, at, 'conflict_flagged', { fromStatus: rival.status, toStatus: 'disputed' });
      }
    }
    await db.memoryItems.put({
      ...item,
      status: 'disputed',
      conflictsWith: [...linked],
      updatedAt: at,
    });
    if (item.status !== 'disputed') {
      await record(item, at, 'conflict_flagged', { fromStatus: item.status, toStatus: 'disputed' });
    }
  }

  async function insertItem(
    args: {
      id: string;
      projectId: string;
      kind: MemoryKind;
      text: string;
      topic: string;
      status: MemoryStatus | undefined;
      evidenceMessageIds: string[];
      origin: MemoryOrigin;
      supersedesId: string | null;
    },
    at: string,
  ): Promise<LocalMemoryItem> {
    const count = await db.memoryItems.where('projectId').equals(args.projectId).count();
    if (count >= maxItems) throw new MemoryLimitError('items');
    const status = chooseInitialStatus(args.kind, args.origin, args.status);
    if (status === null) throw new MemoryValidationError(['status']);
    const evidence = await buildEvidence(args.evidenceMessageIds, at);
    const item: LocalMemoryItem = {
      id: args.id,
      projectId: args.projectId,
      kind: args.kind,
      text: args.text,
      topic: args.topic,
      status,
      origin: args.origin,
      evidence,
      conflictsWith: [],
      supersededById: null,
      supersedesId: args.supersedesId,
      createdAt: at,
      updatedAt: at,
      schemaVersion: MEMORY_SCHEMA_VERSION,
    };
    await db.memoryItems.add(item);
    await record(item, at, 'created', { toStatus: status });
    await applyConflictRules(item.id, at);
    return requireItem(item.id);
  }

  async function create(
    projectId: string,
    raw: unknown,
    createOptions: { origin?: MemoryOrigin } = {},
  ): Promise<LocalMemoryItem> {
    const parsed = CreateMemoryInputSchema.safeParse(raw);
    if (!parsed.success) throw new MemoryValidationError(fieldNames(parsed.error));
    const input = parsed.data;
    const origin = createOptions.origin ?? 'user';
    return inTx(async () => {
      if (!(await db.projects.get(projectId))) throw new MemoryProjectNotFoundError(projectId);
      return insertItem(
        {
          id: newId(),
          projectId,
          kind: input.kind,
          text: input.text,
          topic: input.topic,
          status: input.status,
          evidenceMessageIds: input.evidenceMessageIds,
          origin,
          supersedesId: null,
        },
        now(),
      );
    });
  }

  async function update(id: string, raw: unknown): Promise<LocalMemoryItem> {
    const parsed = UpdateMemoryInputSchema.safeParse(raw);
    if (!parsed.success) throw new MemoryValidationError(fieldNames(parsed.error));
    const patch = parsed.data;
    return inTx(async () => {
      const item = await requireItem(id);
      assertEditable(item);
      const text = patch.text ?? item.text;
      const topic = patch.topic ?? item.topic;
      if (text === item.text && topic === item.topic) return item;
      const at = now();
      // An edit can change which conflicts apply, so recompute them from scratch.
      const status: MemoryStatus = item.status === 'disputed' ? 'proposed' : item.status;
      await db.memoryItems.put({ ...item, text, topic, status, conflictsWith: [], updatedAt: at });
      await record(item, at, 'edited', {
        fromStatus: item.status,
        toStatus: status,
        fromText: item.text,
      });
      await repairConflicts(item.projectId, at);
      await applyConflictRules(id, at);
      return requireItem(id);
    });
  }

  async function setStatus(id: string, status: MemoryStatus): Promise<LocalMemoryItem> {
    return inTx(async () => {
      const item = await requireItem(id);
      if (item.status === 'superseded') {
        throw new InvalidMemoryOperationError('Superseded items are read-only.');
      }
      if (item.status === 'disputed') {
        throw new InvalidMemoryOperationError('Resolve the conflict before changing this status.');
      }
      if (!canTransition(item.kind, item.status, status)) {
        throw new InvalidMemoryOperationError(`A ${item.kind} cannot be set to "${status}".`);
      }
      if (status === item.status) return item;
      const at = now();
      await db.memoryItems.put({ ...item, status, updatedAt: at });
      await record(item, at, 'status_changed', { fromStatus: item.status, toStatus: status });
      return requireItem(id);
    });
  }

  /** Replaces an item. The old one is kept as read-only history, linked to its replacement. */
  async function supersede(
    oldId: string,
    raw: unknown,
  ): Promise<{ old: LocalMemoryItem; replacement: LocalMemoryItem }> {
    const parsed = SupersedeInputSchema.safeParse(raw);
    if (!parsed.success) throw new MemoryValidationError(fieldNames(parsed.error));
    const input = parsed.data;
    return inTx(async () => {
      const old = await requireItem(oldId);
      assertEditable(old);
      const at = now();
      const replacementId = newId();
      await db.memoryItems.put({
        ...old,
        status: 'superseded',
        supersededById: replacementId,
        conflictsWith: [],
        updatedAt: at,
      });
      await record(old, at, 'superseded', { fromStatus: old.status, toStatus: 'superseded' });
      await repairConflicts(old.projectId, at);
      const replacement = await insertItem(
        {
          id: replacementId,
          projectId: old.projectId,
          kind: old.kind,
          text: input.text,
          topic: input.topic ?? old.topic,
          status: input.status,
          evidenceMessageIds: input.evidenceMessageIds,
          origin: 'user',
          supersedesId: old.id,
        },
        at,
      );
      return { old: await requireItem(oldId), replacement };
    });
  }

  /** Keeps `winnerId` as confirmed and supersedes every item it was in conflict with. */
  async function resolveConflict(winnerId: string): Promise<LocalMemoryItem> {
    return inTx(async () => {
      const winner = await requireItem(winnerId);
      if (winner.status !== 'disputed') {
        throw new InvalidMemoryOperationError('This item is not in a conflict.');
      }
      const at = now();
      const rivals = (await db.memoryItems.bulkGet(winner.conflictsWith)).filter(
        (rival): rival is LocalMemoryItem => rival !== undefined && rival.status === 'disputed',
      );
      for (const rival of rivals) {
        await db.memoryItems.put({
          ...rival,
          status: 'superseded',
          supersededById: winner.id,
          conflictsWith: [],
          updatedAt: at,
        });
        await record(rival, at, 'conflict_resolved', { fromStatus: 'disputed', toStatus: 'superseded' });
      }
      await db.memoryItems.put({ ...winner, status: 'confirmed', conflictsWith: [], updatedAt: at });
      await record(winner, at, 'conflict_resolved', { fromStatus: 'disputed', toStatus: 'confirmed' });
      await repairConflicts(winner.projectId, at);
      return requireItem(winnerId);
    });
  }

  async function addEvidence(id: string, messageId: string): Promise<LocalMemoryItem> {
    return inTx(async () => {
      const item = await requireItem(id);
      assertEditable(item);
      if (item.evidence.some((ref) => ref.messageId === messageId)) return item;
      if (item.evidence.length >= maxEvidence) throw new MemoryLimitError('evidence');
      const at = now();
      const [ref] = await buildEvidence([messageId], at);
      if (!ref) throw new MemoryEvidenceNotFoundError(messageId);
      await db.memoryItems.put({ ...item, evidence: [...item.evidence, ref], updatedAt: at });
      await record(item, at, 'evidence_added');
      return requireItem(id);
    });
  }

  async function removeEvidence(id: string, messageId: string): Promise<LocalMemoryItem> {
    return inTx(async () => {
      const item = await requireItem(id);
      assertEditable(item);
      const evidence = item.evidence.filter((ref) => ref.messageId !== messageId);
      if (evidence.length === item.evidence.length) return item;
      const at = now();
      await db.memoryItems.put({ ...item, evidence, updatedAt: at });
      await record(item, at, 'evidence_removed');
      return requireItem(id);
    });
  }

  /** Compares each linked message with what is stored now. Returns the live message, never a copy. */
  async function inspectEvidence(id: string): Promise<EvidenceView[]> {
    const item = await requireItem(id);
    const views: EvidenceView[] = [];
    for (const ref of item.evidence) {
      const message = (await db.messages.get(ref.messageId)) ?? null;
      const state: EvidenceState = !message
        ? 'missing'
        : message.contentHash === ref.contentHash
          ? 'ok'
          : 'changed';
      views.push({ ref, state, message });
    }
    return views;
  }

  async function remove(id: string): Promise<void> {
    await inTx(async () => {
      const item = await db.memoryItems.get(id);
      if (!item) return;
      const at = now();
      await db.memoryItems.delete(id);
      await db.memoryHistory.where('itemId').equals(id).delete();
      const rest = await db.memoryItems.where('projectId').equals(item.projectId).toArray();
      for (const other of rest) {
        if (other.supersededById === id || other.supersedesId === id) {
          await db.memoryItems.put({
            ...other,
            supersededById: other.supersededById === id ? null : other.supersededById,
            supersedesId: other.supersedesId === id ? null : other.supersedesId,
            updatedAt: at,
          });
        }
      }
      await repairConflicts(item.projectId, at);
    });
  }

  async function removeAllForProject(projectId: string): Promise<void> {
    await inTx(async () => {
      await db.memoryItems.where('projectId').equals(projectId).delete();
      await db.memoryHistory.where('projectId').equals(projectId).delete();
    });
  }

  /** Oldest first. */
  async function list(
    projectId: string,
    filter: { kinds?: readonly MemoryKind[]; statuses?: readonly MemoryStatus[] } = {},
  ): Promise<LocalMemoryItem[]> {
    const all = await db.memoryItems.where('projectId').equals(projectId).toArray();
    return all
      .filter((item) => !filter.kinds || filter.kinds.includes(item.kind))
      .filter((item) => !filter.statuses || filter.statuses.includes(item.status))
      .sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
      );
  }

  const get = (id: string): Promise<LocalMemoryItem | undefined> => db.memoryItems.get(id);

  const byTime = (a: MemoryHistoryEntry, b: MemoryHistoryEntry): number =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.n - b.n;

  async function history(itemId: string): Promise<MemoryHistoryEntry[]> {
    return (await db.memoryHistory.where('itemId').equals(itemId).toArray()).sort(byTime);
  }

  async function historyForProject(projectId: string): Promise<MemoryHistoryEntry[]> {
    return (await db.memoryHistory.where('projectId').equals(projectId).toArray()).sort(byTime);
  }

  return {
    create,
    update,
    setStatus,
    supersede,
    resolveConflict,
    addEvidence,
    removeEvidence,
    inspectEvidence,
    remove,
    removeAllForProject,
    list,
    get,
    history,
    historyForProject,
  };
}

export type MemoryRepository = ReturnType<typeof createMemoryRepository>;