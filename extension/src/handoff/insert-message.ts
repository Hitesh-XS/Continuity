import { z } from 'zod';
import { ProviderIdSchema } from '../shared/messages';

/** A package is at most a few tens of thousands of tokens: refuse anything absurd. */
export const MAX_INSERT_CHARS = 500_000;

export const INSERT_ERROR_CODES = [
  'access_off',
  'not_new_chat',
  'composer_not_found',
  'composer_not_empty',
  'insert_failed',
  'left_partial',
  'forbidden',
] as const;
export type InsertErrorCode = (typeof INSERT_ERROR_CODES)[number];

/** Problems the side panel itself detects before or while talking to the page. */
export const PANEL_ERROR_CODES = ['no_claude_tab', 'unreachable', 'bad_response'] as const;
export type PanelErrorCode = (typeof PANEL_ERROR_CODES)[number];

/** Side panel -> page script. */
export const PanelToPageMessageSchema = z.object({
  type: z.literal('handoff.insert'),
  providerId: ProviderIdSchema,
  text: z.string().min(1).max(MAX_INSERT_CHARS),
});

export const InsertResultSchema = z.union([
  z.object({ ok: z.literal(true), method: z.enum(['insertText', 'paste']) }),
  z.object({ ok: z.literal(false), error: z.enum(INSERT_ERROR_CODES) }),
]);
export type InsertResult = z.infer<typeof InsertResultSchema>;

export const INSERT_ERROR_TEXT: Record<InsertErrorCode | PanelErrorCode, string> = {
  access_off:
    'Turn on Claude capture first (the Claude capture card), so Continuity may work on claude.ai.',
  not_new_chat:
    'Open a NEW Claude chat (claude.ai/new) in this tab first. The package is only inserted into an empty new chat.',
  composer_not_found:
    "Could not find the message box on this page. Claude's page may have changed: use Copy instead.",
  composer_not_empty:
    'The message box already has text. Clear it, or open a new chat, and try again. Continuity never overwrites what you typed.',
  insert_failed:
    'The message box did not accept the text. Check it for an attached file or partial text, then use Copy and paste it yourself.',
  left_partial:
    'Some text may have been inserted and could not be cleared. Clear the message box yourself, then use Copy.',
  forbidden: 'The request was not accepted by the page.',
  no_claude_tab: 'Open a new Claude chat (claude.ai/new) in the current tab first.',
  unreachable:
    'Could not reach the Claude page. Reload the claude.ai tab (it needs the latest extension version) and try again.',
  bad_response: 'The page gave an unexpected answer. Use Copy instead.',
};

/** Only this extension's own pages (the side panel) may ask a page to insert text. */
export function isTrustedExtensionPage(
  sender: { id?: string | undefined; url?: string | undefined },
  extensionId: string,
): boolean {
  if (!extensionId || sender.id !== extensionId) return false;
  return typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}