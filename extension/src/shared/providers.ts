export const PROVIDER_IDS = ['claude'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Exact origin, no trailing slash. Compared against URL.origin. */
  readonly origin: string;
  /** Match patterns for the optional host permission and script registration. */
  readonly matches: readonly string[];
  readonly contentScriptId: string;
  /** Path inside the built extension. Verify against .output/chrome-mv3/content-scripts/ */
  readonly contentScriptFile: string;
}

export const CLAUDE: ProviderDefinition = {
  id: 'claude',
  displayName: 'Claude',
  origin: 'https://claude.ai',
  matches: ['https://claude.ai/*'],
  contentScriptId: 'continuity-claude',
  contentScriptFile: 'content-scripts/claude.js',
};

export const PROVIDERS: readonly ProviderDefinition[] = [CLAUDE];

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Match by exact origin, so lookalikes such as claude.ai.evil.example never match. */
export function providerForUrl(url: string | undefined): ProviderDefinition | undefined {
  if (!url) return undefined;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return undefined;
  }
  return PROVIDERS.find((provider) => provider.origin === origin);
}