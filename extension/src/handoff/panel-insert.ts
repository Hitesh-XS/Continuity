import { CLAUDE, providerForUrl } from '../shared/providers';
import { isNewChatUrl } from './composer';
import { InsertResultSchema, type InsertResult, type PanelErrorCode } from './insert-message';
import { classifySendError } from './send-errors';

export type PanelInsertOutcome = InsertResult | { ok: false; error: PanelErrorCode };

export interface PanelInsertDeps {
  queryActiveTab(): Promise<{ id?: number | undefined; url?: string | undefined } | undefined>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  injectScript(tabId: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

type Attempt =
  | { kind: 'result'; result: InsertResult }
  | { kind: 'bad_response' }
  | { kind: 'failed'; failure: ReturnType<typeof classifySendError> };

/**
 * Asks the Claude page in the current tab to put `text` in its message box. Never sends it.
 * If no script is listening, it starts one and retries ONCE. It never retries after the page
 * received the request, because that attempt may already have inserted text.
 */
export async function insertViaTab(deps: PanelInsertDeps, text: string): Promise<PanelInsertOutcome> {
  let tab: Awaited<ReturnType<PanelInsertDeps['queryActiveTab']>>;
  try {
    tab = await deps.queryActiveTab();
  } catch {
    return { ok: false, error: 'no_claude_tab' };
  }
  // tab.url is visible only once the user has granted access to claude.ai.
  if (tab?.id === undefined || providerForUrl(tab.url)?.id !== CLAUDE.id) {
    return { ok: false, error: 'no_claude_tab' };
  }
  if (!isNewChatUrl(tab.url)) return { ok: false, error: 'not_new_chat' };

  const tabId = tab.id;
  const message = { type: 'handoff.insert', providerId: CLAUDE.id, text };

  const attempt = async (): Promise<Attempt> => {
    try {
      const parsed = InsertResultSchema.safeParse(await deps.sendMessage(tabId, message));
      return parsed.success ? { kind: 'result', result: parsed.data } : { kind: 'bad_response' };
    } catch (error) {
      return { kind: 'failed', failure: classifySendError(error) };
    }
  };

  let outcome = await attempt();
  if (outcome.kind === 'failed' && outcome.failure === 'no_receiver') {
    try {
      await deps.injectScript(tabId);
    } catch {
      return { ok: false, error: 'inject_failed' };
    }
    await deps.wait(300);
    outcome = await attempt();
  }

  if (outcome.kind === 'result') return outcome.result;
  if (outcome.kind === 'bad_response') return { ok: false, error: 'bad_response' };
  if (outcome.failure === 'no_receiver') return { ok: false, error: 'no_receiver' };
  if (outcome.failure === 'port_closed') return { ok: false, error: 'port_closed' };
  return { ok: false, error: 'unreachable' };
}