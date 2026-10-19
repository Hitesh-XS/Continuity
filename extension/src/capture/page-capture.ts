import type { AdapterHealth, CaptureStatus } from '../shared/messages';
import { CLAUDE } from '../shared/providers';
import {
  CLAUDE_SELECTORS,
  domFingerprint,
  extractClaudeSnapshot,
  maxRowIndex,
} from './adapters/claude';

export interface PageCaptureDeps {
  root: ParentNode;
  getUrl(): string;
  getTitle(): string;
  send(message: unknown): Promise<unknown>;
  /** Watches a node for changes and returns a function that stops watching. */
  observe(target: Node, callback: () => void): () => void;
  now(): number;
  /** False once the extension has been reloaded and this script is orphaned. */
  isAlive?(): boolean;
}

export interface PageCaptureOptions {
  quietMs?: number;
  pollMs?: number;
  navigationGraceMs?: number;
}

function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function responseOk(response: unknown): boolean {
  return typeof response === 'object' && response !== null && (response as { ok?: unknown }).ok === true;
}

function responseError(response: unknown): string {
  const error = (response as { error?: unknown } | undefined)?.error;
  return typeof error === 'string' ? error : 'no_response';
}

/**
 * Reads the page ONLY while status is "on". Everything else (debounce, streaming, navigation,
 * pause/resume) is decided here so it can be tested without a browser.
 */
export function createPageCapture(deps: PageCaptureDeps, options: PageCaptureOptions = {}) {
  const quietMs = options.quietMs ?? 1500;
  const pollMs = options.pollMs ?? 300;
  const graceMs = options.navigationGraceMs ?? 10_000;

  let status: CaptureStatus = 'off';
  let stopped = false;
  let running = false;
  let runTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnect: (() => void) | undefined;
  let observedFeed: Element | null | undefined;
  let lastUrl = deps.getUrl();
  let lastSignature = '';
  let lastHealthKey = '';
  let staleFingerprint: string | null = null;
  let navigatedAt = 0;
  const baselines = new Map<string, number>();

  function clearRun(): void {
    if (runTimer !== undefined) clearTimeout(runTimer);
    runTimer = undefined;
  }

  function schedule(delay: number): void {
    if (stopped || status !== 'on') return;
    clearRun();
    runTimer = setTimeout(() => {
      runTimer = undefined;
      void run();
    }, delay);
  }

  function detach(): void {
    disconnect?.();
    disconnect = undefined;
    observedFeed = undefined;
  }

  function attach(): void {
    const feed = deps.root.querySelector(CLAUDE_SELECTORS.transcript);
    if (feed === observedFeed) return;
    disconnect?.();
    disconnect = undefined;
    observedFeed = feed;
    if (feed) {
      disconnect = deps.observe(feed, () => schedule(quietMs));
      schedule(quietMs);
    }
  }

  function onNavigation(url: string): void {
    lastUrl = url;
    lastSignature = '';
    lastHealthKey = '';
    // Remember what was on screen at the moment the URL changed. Until the page content
    // differs from this, any rows we can see still belong to the PREVIOUS conversation.
    staleFingerprint = domFingerprint(deps.root);
    navigatedAt = deps.now();
    detach();
    schedule(quietMs);
  }

  function poll(): void {
    pollTimer = undefined;
    if (stopped) return;
    if (deps.isAlive && !deps.isAlive()) {
      stop();
      return;
    }
    if (status === 'on') {
      const url = deps.getUrl();
      if (url !== lastUrl) onNavigation(url);
      attach();
    } else {
      lastUrl = deps.getUrl();
    }
    pollTimer = setTimeout(poll, pollMs);
  }

  async function reportHealth(health: AdapterHealth): Promise<void> {
    const key = `${health.state}|${health.rows}|${health.extracted}|${health.unrecognized}`;
    if (key === lastHealthKey) return;
    lastHealthKey = key;
    await deps.send({ type: 'capture.health', providerId: CLAUDE.id, health });
  }

  async function runOnce(): Promise<void> {
    const url = deps.getUrl();

    if (staleFingerprint !== null) {
      const age = deps.now() - navigatedAt;
      if (age < graceMs && domFingerprint(deps.root) === staleFingerprint) {
        schedule(500); // still the old page's content: wait for the new conversation to render
        return;
      }
      staleFingerprint = null;
    }

    const conversationId = CLAUDE.conversationIdFromUrl(url);
    const skip = conversationId ? baselines.get(conversationId) : undefined;
    const outcome = extractClaudeSnapshot(deps.root, {
      url,
      title: deps.getTitle(),
      ...(skip !== undefined ? { skipUpToIndex: skip } : {}),
    });

    await reportHealth(outcome.health);

    if ((outcome.kind === 'snapshot' || outcome.kind === 'empty') && outcome.streaming) {
      schedule(2000); // a reply is still being written: look again shortly
    }
    if (outcome.kind !== 'snapshot') return;

    const signature = hashString(JSON.stringify(outcome.snapshot));
    if (signature === lastSignature) return;

    const response = await deps.send({
      type: 'capture.snapshot',
      providerId: CLAUDE.id,
      snapshot: outcome.snapshot,
    });
    if (responseOk(response)) {
      lastSignature = signature;
    } else {
      // Log the error code only, never message content.
      console.warn('Continuity: snapshot not stored:', responseError(response));
    }
  }

  async function run(): Promise<void> {
    if (stopped || status !== 'on') return;
    if (running) {
      schedule(quietMs);
      return;
    }
    running = true;
    try {
      await runOnce();
    } finally {
      running = false;
    }
  }

  function setStatus(next: CaptureStatus): void {
    if (next === status) return;
    const previous = status;
    status = next;
    clearRun();

    if (next !== 'on') {
      staleFingerprint = null;
      detach(); // not capturing: do not even watch the page
      return;
    }

    if (previous === 'off') baselines.clear();
    if (previous === 'paused') {
      // Messages already on screen were written during the pause: never capture them.
      const conversationId = CLAUDE.conversationIdFromUrl(deps.getUrl());
      const max = maxRowIndex(deps.root);
      if (conversationId && max !== undefined) baselines.set(conversationId, max);
    }
    lastUrl = deps.getUrl();
    lastHealthKey = '';
    attach();
    schedule(quietMs);
  }

  function start(): void {
    if (stopped || pollTimer !== undefined) return;
    pollTimer = setTimeout(poll, pollMs);
  }

  function stop(): void {
    stopped = true;
    clearRun();
    if (pollTimer !== undefined) clearTimeout(pollTimer);
    pollTimer = undefined;
    detach();
  }

  return { start, stop, setStatus };
}

export type PageCapture = ReturnType<typeof createPageCapture>;