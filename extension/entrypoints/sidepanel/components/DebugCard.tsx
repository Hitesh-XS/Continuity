import { useEffect, useState } from 'react';
import { useActiveTabStatus, useAdapterHealth } from '../hooks';

const HEALTH_TEXT = {
  ok: 'Reading normally',
  degraded: 'Claude page layout not recognised: messages cannot be read',
  no_transcript: 'No conversation found on this page (it may still be loading)',
  no_conversation: 'This page is not a conversation',
} as const;

interface Props {
  projectCount: number | null;
  conversationCount: number | null;
}

export function DebugCard({ projectCount, conversationCount }: Props) {
  const tab = useActiveTabStatus();
  const health = useAdapterHealth();
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    const result = navigator.storage?.persisted?.();
    if (result) void result.then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const d = health?.detail;

  return (
    <section className="card">
      <h2>Debug</h2>
      <dl>
        <dt>Extension version</dt>
        <dd>{chrome.runtime.getManifest().version}</dd>
        <dt>Projects in this browser</dt>
        <dd>{projectCount ?? '…'}</dd>
        <dt>Captured conversations</dt>
        <dd>{conversationCount ?? '…'}</dd>
        <dt>Persistent storage granted</dt>
        <dd>{persisted === null ? 'unknown' : persisted ? 'yes' : 'no (best effort)'}</dd>
        <dt>Active tab</dt>
        <dd>
          {tab
            ? `${tab.providerId} page at ${tab.path} (seen ${tab.seenAt})`
            : 'no supported page detected'}
        </dd>
        <dt>Page reading</dt>
        <dd>
          {health
            ? `${HEALTH_TEXT[health.state]} (rows ${health.rows}, read ${health.extracted}, skipped ${health.unrecognized})`
            : 'no report yet (capture must be On)'}
        </dd>
        {d && health && health.unrecognized > 0 ? (
          <>
            <dt>Why rows were skipped</dt>
            <dd>
              {`no index ${d.noIndex} · other role ${d.unknownRole} · duplicate ${d.duplicateIndex} · no text container ${d.noTextContainer} · empty text ${d.emptyText} (raw chars ${d.emptyTextRawChars})`}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}