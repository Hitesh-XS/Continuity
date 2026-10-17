import { z } from 'zod';
import type { CaptureStatus } from './messages';
import type { ProviderId } from './providers';

export const ProviderSettingsSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  /** When the user accepted the disclosure; null while capture is off. */
  consentAt: z.string().nullable(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1),
  activeProjectId: z.string().uuid().nullable(),
  providers: z.record(z.string(), ProviderSettingsSchema),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  enabled: false,
  paused: false,
  consentAt: null,
};

export function defaultSettings(): Settings {
  return { schemaVersion: 1, activeProjectId: null, providers: {} };
}

/** Never throws: unknown or corrupted stored data falls back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const result = SettingsSchema.safeParse(raw);
  return result.success ? result.data : defaultSettings();
}

export function getProviderSettings(settings: Settings, id: ProviderId): ProviderSettings {
  return settings.providers[id] ?? DEFAULT_PROVIDER_SETTINGS;
}

/** Capture is "on" only if Chrome granted site access AND the user enabled it AND it is not paused. */
export function deriveCaptureStatus(
  input: { hasPermission: boolean } & ProviderSettings,
): CaptureStatus {
  if (!input.hasPermission || !input.enabled) return 'off';
  return input.paused ? 'paused' : 'on';
}

function withProvider(settings: Settings, id: ProviderId, next: ProviderSettings): Settings {
  return { ...settings, providers: { ...settings.providers, [id]: next } };
}

export function withProviderEnabled(settings: Settings, id: ProviderId, nowIso: string): Settings {
  return withProvider(settings, id, { enabled: true, paused: false, consentAt: nowIso });
}

/** Disabling forgets consent, so enabling again shows the disclosure again. */
export function withProviderDisabled(settings: Settings, id: ProviderId): Settings {
  return withProvider(settings, id, { ...DEFAULT_PROVIDER_SETTINGS });
}

export function withProviderPaused(settings: Settings, id: ProviderId, paused: boolean): Settings {
  const current = getProviderSettings(settings, id);
  if (!current.enabled) return settings;
  return withProvider(settings, id, { ...current, paused });
}

export function withActiveProject(settings: Settings, projectId: string | null): Settings {
  return { ...settings, activeProjectId: projectId };
}