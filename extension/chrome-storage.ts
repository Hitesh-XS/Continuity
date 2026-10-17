import type { StorageAreaLike } from '../shared/settings-store';

// chrome.* is touched only when these functions are called, never at import time.
export const localArea: StorageAreaLike = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
};