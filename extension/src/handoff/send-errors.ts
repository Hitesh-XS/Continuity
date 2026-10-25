export type SendFailure = 'no_receiver' | 'port_closed' | 'other';

/**
 * Sorts a chrome.tabs.sendMessage rejection into a category. The text is matched, never shown:
 * Chrome's messages are fixed strings, but we only use the category.
 */
export function classifySendError(error: unknown): SendFailure {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/receiving end does not exist|could not establish connection/i.test(message)) {
    return 'no_receiver';
  }
  if (/message port closed|port closed before a response|message channel closed/i.test(message)) {
    return 'port_closed';
  }
  return 'other';
}