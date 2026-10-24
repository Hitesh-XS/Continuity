import { isNewChatUrl } from '../../src/handoff/composer';
import {
  InsertResultSchema,
  type InsertResult,
  type PanelErrorCode,
} from '../../src/handoff/insert-message';
import { CLAUDE, providerForUrl } from '../../src/shared/providers';

export type PanelInsertOutcome = InsertResult | { ok: false; error: PanelErrorCode };

/** Asks the Claude page in the current tab to put `text` in its message box. Never sends it. */
export async function insertIntoActiveClaudeTab(text: string): Promise<PanelInsertOutcome> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return { ok: false, error: 'no_claude_tab' };
  }
  // tab.url is visible only once the user has granted access to claude.ai.
  if (tab?.id === undefined || providerForUrl(tab.url)?.id !== CLAUDE.id) {
    return { ok: false, error: 'no_claude_tab' };
  }
  if (!isNewChatUrl(tab.url)) return { ok: false, error: 'not_new_chat' };

  try {
    const response: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: 'handoff.insert',
      providerId: CLAUDE.id,
      text,
    });
    const parsed = InsertResultSchema.safeParse(response);
    return parsed.success ? parsed.data : { ok: false, error: 'bad_response' };
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}