import { insertViaTab, type PanelInsertOutcome } from '../../src/handoff/panel-insert';
import { CLAUDE } from '../../src/shared/providers';

export type { PanelInsertOutcome };

/** Asks the Claude page in the current tab to put `text` in its message box. Never sends it. */
export function insertIntoActiveClaudeTab(text: string): Promise<PanelInsertOutcome> {
  return insertViaTab(
    {
      async queryActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
      },
      sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
      async injectScript(tabId) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [CLAUDE.contentScriptFile],
        });
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    text,
  );
}