export const CONVERSATION_ID = '0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab';
export const CHAT_URL = `https://claude.ai/chat/${CONVERSATION_ID}`;

const USER_ACTIONS = `<div data-cds="MessageActions" role="toolbar" aria-label="Message actions"><time datetime="2026-10-18T15:51:00Z">9:21 PM</time><button type="button" data-testid="user-message-retry" aria-label="Retry"><span data-cds="Icon" aria-hidden="true">R</span></button><button type="button" data-testid="user-message-copy" aria-label="Copy"><span data-cds="Icon" aria-hidden="true">C</span></button><span role="status" class="sr-only"></span></div>`;

const ASSISTANT_ACTIONS = `<div data-cds="MessageActions" role="toolbar" aria-label="Message actions" data-testid="message-actions"><button type="button" data-testid="action-bar-copy" aria-label="Copy"><span data-cds="Icon" aria-hidden="true">C</span></button><span role="status" class="sr-only"></span><button type="button" data-testid="action-bar-retry" aria-label="Retry"><span data-cds="Icon" aria-hidden="true">R</span></button><time datetime="2026-10-18T15:51:10Z">9:21 PM</time></div>`;

function userRow(index: number, fromTail: number, text: string): string {
  return `
<div data-rs-index="${index}" data-index="${index}" data-testid="transcript-row" data-perf-row="human" data-perf-row-from-tail="${fromTail}" data-perf-row-streaming="false">
  <div role="article" tabindex="-1">
    <div data-test-render-count="2">
      <div class="contents">
        <div class="mb-1 group/message-row">
          <h2 data-find-omitted="" class="sr-only select-none">You said: ${text}</h2>
          <div class="flex flex-col items-end gap-1">
            <div data-cds="UserMessage">
              <div class="relative">
                <div class="cds-user-message-body">
                  <div data-testid="user-message" class="grid grid-cols-1 gap-2"><p class="whitespace-pre-wrap break-words" dir="ltr">${text}</p></div>
                </div>
              </div>
              ${USER_ACTIONS}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

function assistantRow(index: number, fromTail: number, replyHtml: string): string {
  return `
<div data-rs-index="${index}" data-index="${index}" data-testid="transcript-row" data-perf-row="assistant" data-perf-row-from-tail="${fromTail}" data-perf-row-streaming="false">
  <div role="article" tabindex="-1">
    <div data-test-render-count="2">
      <div class="group/message-row">
        <div class="contents">
          <div data-testid="assistant-message" class="group relative" data-is-streaming="false">
            <h2 data-find-omitted="" class="sr-only select-none">Claude responded: a reply</h2>
            <div class="font-claude-response relative">
              <div class="">
                <div data-cds="Prose" class="prose">
                  <div data-perf-reply-text="" class="standard-markdown grid">${replyHtml}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        ${ASSISTANT_ACTIONS}
      </div>
    </div>
  </div>
</div>`;
}

const CODE_REPLY = `<div data-not-prose=""><div role="group" aria-label="Code block" tabindex="0" dir="ltr" class="relative group/copy"><div class="sticky"><div class="absolute"><button type="button" data-testid="code-block-copy" aria-label="Copy"><span data-cds="Icon" aria-hidden="true">C</span></button><span role="status" class="sr-only"></span></div></div><div class="text-secondary font-small" data-find-omitted="">python</div><div class="overflow-x-auto"><pre class="code-block__code"><code class="language-python" data-highlight="final"><span class="block" data-code-line-group=""><span><span>def</span> <span>add</span>(a, b):\n    <span>return</span> a + b</span></span></code></pre></div></div></div><p dir="ltr">Simple and direct.</p>`;

const LIST_REPLY = `<p dir="ltr">Two quick tips:</p><ul dir="ltr"><li><strong>Name things:</strong> use <code dir="ltr">snake_case</code> names.</li><li><strong>Add tests:</strong> cover <code dir="ltr">add(0, 0)</code>.</li></ul>`;

export const CLAUDE_TRANSCRIPT_HTML = `
<div role="feed" data-perf-region="transcript" aria-label="Conversation">
  <p class="sr-only select-none">Conversation transcript</p>
  <div data-sizer-excess="0" data-testid="transcript-sizer">
    <div aria-hidden="true" data-testid="transcript-spacer"></div>
    ${userRow(0, 3, 'Write an add function')}
    ${assistantRow(1, 2, CODE_REPLY)}
    ${userRow(2, 1, 'Now two tips as a bullet list')}
    ${assistantRow(3, 0, LIST_REPLY)}
    <div aria-hidden="true" data-testid="transcript-spacer"></div>
  </div>
</div>`;