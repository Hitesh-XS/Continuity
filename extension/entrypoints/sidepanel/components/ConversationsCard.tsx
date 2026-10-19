import { useEffect, useState } from 'react';
import type { LocalConversation, LocalMessage, LocalProject } from '../../../src/storage/db';
import { conversationRepo } from '../services';

const MAX_SHOWN_CHARS = 3000;
const ROLE_LABEL = { user: 'You', assistant: 'Claude', system: 'System', unknown: 'Unknown' } as const;

interface Props {
  state: {
    conversations: LocalConversation[] | null;
    error: string | null;
    refresh: () => Promise<void>;
  };
  projects: LocalProject[] | null;
}

export function ConversationsCard({ state, projects }: Props) {
  const { conversations, error: loadError, refresh } = state;
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // a conversation id, or "all"
  const [error, setError] = useState<string | null>(null);

  // Keep an open conversation current while new messages arrive.
  useEffect(() => {
    if (!openId) return;
    let active = true;
    conversationRepo
      .getMessages(openId)
      .then((rows) => {
        if (active) setMessages(rows);
      })
      .catch(() => {
        if (active) setMessages([]);
      });
    return () => {
      active = false;
    };
  }, [openId, conversations]);

  const projectName = (id: string | null): string =>
    (id && projects?.find((project) => project.id === id)?.name) || 'No project';

  async function guarded(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      console.error('Continuity: conversation operation failed', e);
      setError('Could not change captured data in this browser.');
    }
  }

  const toggle = (id: string): void => {
    setMessages(null);
    setOpenId((current) => (current === id ? null : id));
  };

  const onDelete = (id: string): void => {
    void guarded(async () => {
      await conversationRepo.remove(id);
      if (openId === id) setOpenId(null);
      setConfirm(null);
    });
  };

  const onDeleteAll = (): void => {
    void guarded(async () => {
      await conversationRepo.removeAll();
      setOpenId(null);
      setConfirm(null);
    });
  };

  return (
    <section className="card">
      <h2>Captured conversations</h2>
      <p className="muted">Stored only in this browser. Nothing here is sent anywhere.</p>

      {conversations === null && !loadError ? <p className="muted">Loading…</p> : null}
      {conversations !== null && conversations.length === 0 ? (
        <p className="muted">
          Nothing captured yet. Turn capture On, then open a conversation on claude.ai.
        </p>
      ) : null}

      <ul className="projects">
        {(conversations ?? []).map((conversation) => (
          <li key={conversation.id}>
            <div className="row">
              <strong>{conversation.title || '(untitled)'}</strong>
              <span className="tag">{conversation.messageCount} msgs</span>
            </div>
            <p className="muted small-text">
              {projectName(conversation.projectId)} · updated{' '}
              {new Date(conversation.updatedAt).toLocaleString()}
            </p>
            <div className="row gap">
              <button type="button" className="small" onClick={() => toggle(conversation.id)}>
                {openId === conversation.id ? 'Hide' : 'View'}
              </button>
              {confirm === conversation.id ? (
                <>
                  <button
                    type="button"
                    className="small danger"
                    onClick={() => onDelete(conversation.id)}
                  >
                    Confirm delete
                  </button>
                  <button type="button" className="small secondary" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="small secondary"
                  onClick={() => setConfirm(conversation.id)}
                >
                  Delete
                </button>
              )}
            </div>
            {openId === conversation.id ? (
              <div className="messages">
                {messages === null ? <p className="muted">Loading…</p> : null}
                {(messages ?? []).map((message) => (
                  <div key={message.id} className="msg-wrap">
                    <span className="role">{ROLE_LABEL[message.role]}</span>
                    {/* Captured text is untrusted: render it as plain text only. */}
                    <div className="msg">
                      {message.text.length > MAX_SHOWN_CHARS
                        ? `${message.text.slice(0, MAX_SHOWN_CHARS)}\n… (${message.text.length - MAX_SHOWN_CHARS} more characters)`
                        : message.text}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {conversations !== null && conversations.length > 0 ? (
        confirm === 'all' ? (
          <div className="row gap">
            <button type="button" className="small danger" onClick={onDeleteAll}>
              Confirm: delete ALL captured conversations
            </button>
            <button type="button" className="small secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="small secondary" onClick={() => setConfirm('all')}>
            Delete all captured conversations
          </button>
        )
      ) : null}

      {loadError || error ? (
        <p className="error" role="alert">
          {loadError ?? error}
        </p>
      ) : null}
    </section>
  );
}