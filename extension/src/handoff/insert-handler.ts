import type { CaptureStatus } from '../shared/messages';
import { insertIntoComposer, isNewChatUrl } from './composer';
import type { InsertResult } from './insert-message';

export interface InsertHandlerDeps {
  doc: Document;
  getUrl(): string;
  /** The capture status, or undefined when it cannot be read. */
  getStatus(): Promise<CaptureStatus | undefined>;
  wait?: (ms: number) => Promise<void>;
}

/** The checks run in this order: opt-in first, then the page, then the message box. */
export async function handleInsertRequest(
  deps: InsertHandlerDeps,
  text: string,
): Promise<InsertResult> {
  let status: CaptureStatus | undefined;
  try {
    status = await deps.getStatus();
  } catch {
    status = undefined;
  }
  if (status !== 'on' && status !== 'paused') return { ok: false, error: 'access_off' };
  if (!isNewChatUrl(deps.getUrl())) return { ok: false, error: 'not_new_chat' };
  return insertIntoComposer(deps.doc, text, deps.wait ? { wait: deps.wait } : {});
}