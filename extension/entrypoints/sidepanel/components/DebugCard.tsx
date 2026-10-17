import { useEffect, useState } from 'react';
import { useActiveTabStatus } from '../hooks';

export function DebugCard({ projectCount }: { projectCount: number | null }) {
  const tab = useActiveTabStatus();
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    const result = navigator.storage?.persisted?.();
    if (result) void result.then(setPersisted).catch(() => setPersisted(null));
  }, []);

  return (
    <section className="card">
      <h2>Debug</h2>
      <dl>
        <dt>Extension version</dt>
        <dd>{chrome.runtime.getManifest().version}</dd>
        <dt>Projects in this browser</dt>
        <dd>{projectCount ?? '…'}</dd>
        <dt>Persistent storage granted</dt>
        <dd>{persisted === null ? 'unknown' : persisted ? 'yes' : 'no (best effort)'}</dd>
        <dt>Active tab</dt>
        <dd>
          {tab ? `${tab.providerId} page at ${tab.path} (seen ${tab.seenAt})` : 'no supported page detected'}
        </dd>
      </dl>
    </section>
  );
}