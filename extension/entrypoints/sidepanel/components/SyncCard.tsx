import { useState } from 'react';
import { apiMatchPattern, apiOrigin } from '../../../src/shared/api-config';
import { ApiError, AuthExpiredError, NetworkError } from '../../../src/sync/errors';
import { syncEngine, syncSession } from '../services';
import { useSyncStatus } from '../sync-hooks';

const RESULT_TEXT: Record<string, string> = {
  ok: 'Up to date',
  partial: 'Some items did not sync',
  offline: 'Server unreachable: will retry',
  signed_out: 'Signed out: please sign in again',
  error: 'Unexpected error',
};

function explain(error: unknown, signingIn = false): string {
  if (error instanceof ApiError) {
    if (signingIn && error.status === 401) return 'Wrong email or password.';
    if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    return `The server refused the request (${error.status} ${error.code}).`;
  }
  if (error instanceof NetworkError) return `Could not reach ${apiOrigin()}. Is the server running?`;
  if (error instanceof AuthExpiredError) return 'You are signed out. Please sign in again.';
  console.error('Continuity: sync action failed', error instanceof Error ? error.name : 'Error');
  return 'Something went wrong. Please try again.';
}

export function SyncCard() {
  const status = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [understand, setUnderstand] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<string | null>, signingIn = false): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setError(message);
    } catch (e) {
      setError(explain(e, signingIn));
    } finally {
      setBusy(false);
    }
  }

  const onSignIn = (): void => {
    // The permission request must be the first await: it needs the click's user gesture.
    void run(async () => {
      const granted = await chrome.permissions.request({ origins: [apiMatchPattern()] });
      if (!granted) return 'Access to the server was not granted, so sign-in is not possible.';
      const result = await syncSession.signIn(email.trim(), password);
      setPassword('');
      if (result.accountChanged) setNotice('This is a different account: sync was turned off.');
      return null;
    }, true);
  };

  const onEnable = (): void => {
    void run(async () => {
      await syncSession.enableSync();
      setUnderstand(false);
      void syncEngine.run();
      return null;
    });
  };

  const onSyncNow = (): void => {
    void run(async () => {
      const result = await syncEngine.run();
      setNotice(RESULT_TEXT[result.kind] ?? 'Done');
      return null;
    });
  };

  const onRetry = (): void => {
    void run(async () => {
      await syncEngine.retryFailed();
      await syncEngine.run();
      return null;
    });
  };

  const onDisable = (): void => {
    void run(async () => {
      await syncSession.disableSync();
      return null;
    });
  };

  const onSignOut = (): void => {
    void run(async () => {
      await syncSession.signOut();
      return null;
    });
  };

  const onPurge = (): void => {
    void run(async () => {
      const result = await syncEngine.purgeServerData();
      setConfirmPurge(false);
      setNotice(`Removed ${result.deleted} project(s) from the server and turned sync off.`);
      return null;
    });
  };

  if (!status.loaded) {
    return (
      <section className="card">
        <h2>Server sync</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const signedIn = status.email !== null;
  const enabled = status.config.enabled;
  const badge = !signedIn ? 'Signed out' : enabled ? 'On' : 'Off';

  return (
    <section className="card">
      <div className="row">
        <h2>Server sync</h2>
        <span className={`badge ${enabled && signedIn ? 'badge-on' : 'badge-off'}`}>{badge}</span>
      </div>
      <p className="muted">
        Optional. Nothing is sent until you sign in <em>and</em> turn sync on. Server: {apiOrigin()}
      </p>

      {!signedIn ? (
        <>
          <div className="field">
            <label htmlFor="sync-email">Email</label>
            <input
              id="sync-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sync-password">Password</label>
            <input
              id="sync-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button type="button" onClick={onSignIn} disabled={busy || !email.trim() || !password}>
            Sign in
          </button>
          <p className="muted small-text">
            Chrome will ask to let Continuity talk to {apiOrigin()}. Signing in alone sends no project
            data.
          </p>
        </>
      ) : !enabled ? (
        <>
          <p>
            Signed in as <strong>{status.email}</strong>.
          </p>
          <ul className="disclosure">
            <li>
              If you turn sync on, Continuity sends to {apiOrigin()}: every project&apos;s{' '}
              <strong>name, description, goal, status and sync setting</strong>.
            </li>
            <li>
              For projects set to <strong>Details + checkpoints</strong>, it also sends each
              checkpoint&apos;s objective, next action, decisions, completed work, blockers, notes and
              the <strong>titles and message counts</strong> of linked conversations.
            </li>
            <li>
              It <strong>never</strong> sends your chat messages or anything from claude.ai pages.
            </li>
            <li>
              Deleting something here deletes its server copy the next time sync runs. Data is not
              end-to-end encrypted: whoever runs the server can read it.
            </li>
          </ul>
          <label className="check">
            <input
              type="checkbox"
              checked={understand}
              onChange={(event) => setUnderstand(event.target.checked)}
            />
            I understand
          </label>
          <div className="row gap">
            <button type="button" onClick={onEnable} disabled={busy || !understand}>
              Turn on sync
            </button>
            <button type="button" className="secondary" onClick={onSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Signed in as <strong>{status.email}</strong>.{' '}
            {status.config.lastResult ? RESULT_TEXT[status.config.lastResult] : 'Not synced yet'}
            {status.config.lastRunAt
              ? ` (last change ${new Date(status.config.lastRunAt).toLocaleString()})`
              : ''}
            .
          </p>
          <p className="muted small-text">
            Waiting to upload: {status.pending} · Failed: {status.failed}
          </p>
          <div className="row gap">
            <button type="button" onClick={onSyncNow} disabled={busy}>
              Sync now
            </button>
            {status.failed > 0 ? (
              <button type="button" className="secondary" onClick={onRetry} disabled={busy}>
                Retry failed
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={onDisable} disabled={busy}>
              Turn off sync
            </button>
            <button type="button" className="secondary" onClick={onSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
          <div className="field">
            {confirmPurge ? (
              <div className="row gap">
                <button type="button" className="small danger" onClick={onPurge} disabled={busy}>
                  Confirm: remove my data from the server
                </button>
                <button type="button" className="small secondary" onClick={() => setConfirmPurge(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="small secondary" onClick={() => setConfirmPurge(true)}>
                Remove my synced data from the server
              </button>
            )}
            <p className="muted small-text">
              Deletes every project this browser uploaded, with its checkpoints, and turns sync off.
              Your local data stays.
            </p>
          </div>
        </>
      )}

      {notice ? <p className="ok">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}