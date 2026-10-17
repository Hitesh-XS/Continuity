import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_SETTINGS,
  defaultSettings,
  deriveCaptureStatus,
  getProviderSettings,
  parseSettings,
  withActiveProject,
  withProviderDisabled,
  withProviderEnabled,
  withProviderPaused,
} from '../src/shared/settings';

const NOW = '2026-10-17T10:00:00.000Z';

describe('settings', () => {
  it('starts with nothing enabled and no active project', () => {
    expect(defaultSettings()).toEqual({ schemaVersion: 1, activeProjectId: null, providers: {} });
  });

  it('keeps valid stored data', () => {
    const valid = withActiveProject(
      withProviderEnabled(defaultSettings(), 'claude', NOW),
      crypto.randomUUID(),
    );
    expect(parseSettings(valid)).toEqual(valid);
  });

  it.each([
    undefined,
    null,
    'garbage',
    { schemaVersion: 2, activeProjectId: null, providers: {} },
    { schemaVersion: 1, activeProjectId: 'not-a-uuid', providers: {} },
  ])('falls back to defaults for invalid stored data: %j', (raw) => {
    expect(parseSettings(raw)).toEqual(defaultSettings());
  });

  it('returns defaults for a provider that has no stored settings', () => {
    expect(getProviderSettings(defaultSettings(), 'claude')).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it.each<[boolean, boolean, boolean, string]>([
    [false, true, false, 'off'],
    [true, false, false, 'off'],
    [true, true, true, 'paused'],
    [true, true, false, 'on'],
    [false, false, false, 'off'],
  ])('hasPermission=%s enabled=%s paused=%s -> %s', (hasPermission, enabled, paused, expected) => {
    expect(deriveCaptureStatus({ hasPermission, enabled, paused, consentAt: null })).toBe(expected);
  });

  it('records consent when a provider is enabled', () => {
    const next = withProviderEnabled(defaultSettings(), 'claude', NOW);
    expect(getProviderSettings(next, 'claude')).toEqual({
      enabled: true,
      paused: false,
      consentAt: NOW,
    });
  });

  it('forgets consent when a provider is disabled', () => {
    const enabled = withProviderEnabled(defaultSettings(), 'claude', NOW);
    const next = withProviderDisabled(enabled, 'claude');
    expect(getProviderSettings(next, 'claude')).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it('pauses and resumes an enabled provider', () => {
    const enabled = withProviderEnabled(defaultSettings(), 'claude', NOW);
    const paused = withProviderPaused(enabled, 'claude', true);
    expect(getProviderSettings(paused, 'claude').paused).toBe(true);
    expect(getProviderSettings(withProviderPaused(paused, 'claude', false), 'claude').paused).toBe(
      false,
    );
  });

  it('ignores pause requests while the provider is disabled', () => {
    const settings = defaultSettings();
    expect(withProviderPaused(settings, 'claude', true)).toBe(settings);
  });

  it('sets and clears the active project', () => {
    const id = crypto.randomUUID();
    const set = withActiveProject(defaultSettings(), id);
    expect(set.activeProjectId).toBe(id);
    expect(withActiveProject(set, null).activeProjectId).toBeNull();
  });

  it('never mutates its input', () => {
    const before = defaultSettings();
    const snapshot = JSON.stringify(before);
    withProviderEnabled(before, 'claude', NOW);
    withProviderDisabled(before, 'claude');
    withProviderPaused(before, 'claude', true);
    withActiveProject(before, crypto.randomUUID());
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});