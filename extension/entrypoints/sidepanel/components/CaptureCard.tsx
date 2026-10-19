import { useState } from 'react';
import { disableProvider, enableProvider } from '../../../src/extension/capture-control';
import type { ProviderDefinition } from '../../../src/shared/providers';
import {
  deriveCaptureStatus,
  getProviderSettings,
  withProviderPaused,
  type Settings,
} from '../../../src/shared/settings';
import { useActiveTabStatus, useProviderPermission } from '../hooks';
import { settingsStore } from '../services';

interface Props {
  provider: ProviderDefinition;
  settings: Settings;
}

export function CaptureCard({ provider, settings }: Props) {
  const granted = useProviderPermission(provider);
  const tab = useActiveTabStatus();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerSettings = getProviderSettings(settings, provider.id);
  const status = deriveCaptureStatus({ hasPermission: granted === true, ...providerSettings });

  // Runs a button action; `action` returns an error message or null.
  async function run(action: () => Promise<string | null>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      if (message) setError(message);
    } catch (e) {
      console.error('Continuity: capture control failed', e);
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const onEnable = (): void => {
    // No await before enableProvider: Chrome's permission prompt needs the click's user gesture.
    void run(async () => {
      const result = await enableProvider(provider, settingsStore);
      if (result.ok) return null;
      return result.reason === 'denied'
        ? `Chrome access to ${provider.displayName} was not granted, so capture stays off.`
        : `Could not start the ${provider.displayName} page script. Try reloading the extension.`;
    });
  };

  const onTogglePause = (): void => {
    void run(async () => {
      await settingsStore.update((s) =>
        withProviderPaused(s, provider.id, !providerSettings.paused),
      );
      return null;
    });
  };

  const onRemove = (): void => {
    void run(async () => {
      await disableProvider(provider, settingsStore);
      setConsent(false);
      return null;
    });
  };

  const label = status === 'on' ? 'On' : status === 'paused' ? 'Paused' : 'Off';

  return (
    <section className="card">
      <div className="row">
        <h2>{provider.displayName} capture</h2>
        <span className={`badge badge-${status}`} aria-label={`Capture is ${label}`}>
          {label}
        </span>
      </div>

      {status === 'off' ? (
        <>
          <p>
            Turn this on to let Continuity work on{' '}
            <strong>{provider.origin.replace('https://', '')}</strong> only. Chrome will ask for your
            permission.
          </p>
          <ul className="disclosure">
            <li>
              Once enabled, Continuity <strong>reads the visible messages</strong> (yours and{' '}
              {provider.displayName}&apos;s) of the conversation you have open on this site, and saves
              them <strong>in this browser only</strong> (IndexedDB).
            </li>
            <li>It reads nothing on other sites or pages, and only while capture shows On.</li>
            <li>
              Nothing is sent to any server or AI provider unless you later turn on sync or AI
              processing for a project, and the app will say exactly what is sent.
            </li>
            <li>
              You can view and delete captured conversations in this panel. Pause or Remove access
              stops reading immediately.
            </li>
            <li>
              Messages written while Paused are skipped after you resume, but reloading the page may
              save them.
            </li>
          </ul>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I understand
          </label>
          <button type="button" onClick={onEnable} disabled={!consent || busy}>
            Enable on {provider.displayName}
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            {tab?.providerId === provider.id
              ? `A ${provider.displayName} page is open in this tab.`
              : `No ${provider.displayName} page detected in the current tab. If one was already open, reload it.`}
          </p>
          <div className="row gap">
            <button type="button" onClick={onTogglePause} disabled={busy}>
              {status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="secondary" onClick={onRemove} disabled={busy}>
              Remove access
            </button>
          </div>
        </>
      )}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}