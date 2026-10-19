import type { AdapterHealth } from '../../shared/messages';
import { CLAUDE } from '../../shared/providers';
import {
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_INDEX,
  MAX_MESSAGES_PER_SNAPSHOT,
  MAX_SNAPSHOT_CHARS,
  type MessageRole,
  type Snapshot,
} from '../snapshot';
import { elementToText } from './dom-text';

/** Selectors observed on claude.ai (Oct 2026). If Claude changes its page, fix them HERE only. */
export const CLAUDE_SELECTORS = {
  transcript: '[role="feed"][data-perf-region="transcript"]',
  row: '[data-testid="transcript-row"]',
  userMessage: '[data-testid="user-message"]',
  replyText: '[data-perf-reply-text]',
} as const;

const SEL = CLAUDE_SELECTORS;
const ROLE_BY_ROW: Partial<Record<string, MessageRole>> = { human: 'user', assistant: 'assistant' };

type SnapshotMessage = Snapshot['messages'][number];
type HealthDetail = NonNullable<AdapterHealth['detail']>;

export type ExtractOutcome =
  | { kind: 'no_conversation'; health: AdapterHealth }
  | { kind: 'no_transcript'; health: AdapterHealth }
  | { kind: 'empty'; health: AdapterHealth; streaming: boolean }
  | { kind: 'snapshot'; snapshot: Snapshot; health: AdapterHealth; streaming: boolean };

export interface ExtractInput {
  url: string;
  title: string;
  /** Ignore rows whose index is at or below this (used after Resume). */
  skipUpToIndex?: number;
}

function parseIndex(row: Element): number | undefined {
  const raw = row.getAttribute('data-index') ?? row.getAttribute('data-rs-index');
  if (raw === null || !/^\d{1,7}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value <= MAX_MESSAGE_INDEX ? value : undefined;
}

function isStreaming(row: Element): boolean {
  return (
    row.getAttribute('data-perf-row-streaming') === 'true' ||
    row.querySelector('[data-is-streaming="true"]') !== null
  );
}

interface RowRead {
  text: string;
  /** False when the row has no text container at all (a selector problem). */
  found: boolean;
  /** Length of the raw text inside the container(s), before conversion. Counts only. */
  rawChars: number;
}

function readRow(row: Element, role: MessageRole): RowRead {
  if (role === 'user') {
    const element = row.querySelector(SEL.userMessage);
    if (!element) return { text: '', found: false, rawChars: 0 };
    return { text: elementToText(element), found: true, rawChars: element.textContent?.length ?? 0 };
  }
  const containers = Array.from(row.querySelectorAll(SEL.replyText));
  const outermost = containers.filter(
    (element) => !containers.some((other) => other !== element && other.contains(element)),
  );
  if (outermost.length === 0) return { text: '', found: false, rawChars: 0 };
  const text = outermost
    .map((element) => elementToText(element))
    .filter((part) => part !== '')
    .join('\n\n');
  const rawChars = outermost.reduce((sum, element) => sum + (element.textContent?.length ?? 0), 0);
  return { text, found: true, rawChars };
}

/** Keeps the newest messages that fit the snapshot limits. */
function fitLimits(messages: SnapshotMessage[]): SnapshotMessage[] {
  const recent = messages.slice(-MAX_MESSAGES_PER_SNAPSHOT);
  let total = recent.reduce((sum, message) => sum + message.text.length, 0);
  let start = 0;
  while (start < recent.length - 1 && total > MAX_SNAPSHOT_CHARS) {
    total -= recent[start]?.text.length ?? 0;
    start += 1;
  }
  return recent.slice(start);
}

/** "My chat - Claude" -> "My chat". A bare product name means "no title". */
export function cleanClaudeTitle(raw: string): string {
  const title = raw.replace(/\s*[-–—|·]\s*Claude\s*$/i, '').trim();
  return /^claude$/i.test(title) ? '' : title.slice(0, 300);
}

/** The highest row index currently rendered, or undefined when no rows are. */
export function maxRowIndex(root: ParentNode): number | undefined {
  const transcript = root.querySelector(SEL.transcript);
  if (!transcript) return undefined;
  let max: number | undefined;
  for (const row of Array.from(transcript.querySelectorAll(SEL.row))) {
    const index = parseIndex(row);
    if (index !== undefined && (max === undefined || index > max)) max = index;
  }
  return max;
}

/** A cheap summary of what is on screen: changes when rows or their text lengths change. */
export function domFingerprint(root: ParentNode): string {
  const transcript = root.querySelector(SEL.transcript);
  if (!transcript) return '';
  return Array.from(transcript.querySelectorAll(SEL.row))
    .map((row) => `${row.getAttribute('data-index') ?? '?'}:${row.textContent?.length ?? 0}`)
    .join('|');
}

function makeHealth(
  state: AdapterHealth['state'],
  rows: number,
  extracted: number,
  unrecognized: number,
  detail?: HealthDetail,
): AdapterHealth {
  return { state, rows, extracted, unrecognized, ...(detail ? { detail } : {}) };
}

export function extractClaudeSnapshot(root: ParentNode, input: ExtractInput): ExtractOutcome {
  const conversationId = CLAUDE.conversationIdFromUrl(input.url);
  if (!conversationId) {
    return { kind: 'no_conversation', health: makeHealth('no_conversation', 0, 0, 0) };
  }
  const transcript = root.querySelector(SEL.transcript);
  if (!transcript) {
    return { kind: 'no_transcript', health: makeHealth('no_transcript', 0, 0, 0) };
  }

  const rows = Array.from(transcript.querySelectorAll(SEL.row));
  const messages: SnapshotMessage[] = [];
  const seenIndexes = new Set<number>();
  const detail: HealthDetail = {
    noIndex: 0,
    unknownRole: 0,
    duplicateIndex: 0,
    noTextContainer: 0,
    emptyText: 0,
    emptyTextRawChars: 0,
  };
  let streaming = false;

  for (const row of rows) {
    const index = parseIndex(row);
    if (index === undefined) {
      detail.noIndex += 1;
      continue;
    }
    const role = ROLE_BY_ROW[row.getAttribute('data-perf-row') ?? ''];
    if (role === undefined) {
      detail.unknownRole += 1;
      continue;
    }
    if (seenIndexes.has(index)) {
      detail.duplicateIndex += 1;
      continue;
    }
    seenIndexes.add(index);
    if (input.skipUpToIndex !== undefined && index <= input.skipUpToIndex) continue;
    if (isStreaming(row)) {
      streaming = true; // finished rows are still captured; this one is picked up when it ends
      continue;
    }
    const read = readRow(row, role);
    if (!read.found) {
      detail.noTextContainer += 1;
      continue;
    }
    if (read.text === '') {
      detail.emptyText += 1;
      detail.emptyTextRawChars += read.rawChars;
      continue;
    }
    messages.push({
      index,
      role,
      text: read.text.length > MAX_MESSAGE_CHARS ? read.text.slice(0, MAX_MESSAGE_CHARS) : read.text,
    });
  }

  messages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const kept = fitLimits(messages);
  const unrecognized =
    detail.noIndex +
    detail.unknownRole +
    detail.duplicateIndex +
    detail.noTextContainer +
    detail.emptyText;
  const state = rows.length > 0 && kept.length === 0 && unrecognized > 0 ? 'degraded' : 'ok';
  const health = makeHealth(state, rows.length, kept.length, unrecognized, detail);

  if (kept.length === 0) return { kind: 'empty', health, streaming };

  const title = cleanClaudeTitle(input.title);
  return {
    kind: 'snapshot',
    snapshot: {
      externalConversationId: conversationId,
      ...(title ? { title } : {}),
      messages: kept,
    },
    health,
    streaming,
  };
}