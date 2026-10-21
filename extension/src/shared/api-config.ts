/** The Django API this extension talks to. Change it (and rebuild) for a deployed server. */
export const API_BASE_URL = 'http://127.0.0.1:8000';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Only HTTPS is allowed, except for a server on this same machine. */
export function assertSafeBaseUrl(base: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('API base URL is not a valid URL.');
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('API base URL must use https (http is allowed only for localhost).');
  }
  return url;
}

export function apiOrigin(base: string = API_BASE_URL): string {
  return assertSafeBaseUrl(base).origin;
}

/** Match pattern for the optional host permission. Match patterns carry no port. */
export function apiMatchPattern(base: string = API_BASE_URL): string {
  const url = assertSafeBaseUrl(base);
  return `${url.protocol}//${url.hostname}/*`;
}