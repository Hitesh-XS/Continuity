type LockCallback<T> = (lock: unknown) => Promise<T>;

interface LockManagerLike {
  request<T>(name: string, options: { ifAvailable: boolean }, callback: LockCallback<T>): Promise<T>;
  request<T>(name: string, callback: LockCallback<T>): Promise<T>;
}

function getLocks(): LockManagerLike | undefined {
  return (globalThis as unknown as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
}

/** Runs `fn` while holding a named lock shared by every extension page. Falls back to just running it. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = getLocks();
  return locks ? locks.request(name, async () => fn()) : fn();
}

/** Like withLock, but gives up immediately if someone else holds the lock. */
export async function tryLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const locks = getLocks();
  if (!locks) return { ran: true, value: await fn() };
  return locks.request<{ ran: true; value: T } | { ran: false }>(
    name,
    { ifAvailable: true },
    async (lock) => (lock === null ? { ran: false } : { ran: true, value: await fn() }),
  );
}