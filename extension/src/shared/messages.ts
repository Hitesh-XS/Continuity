import { z } from 'zod';
import { SnapshotSchema } from '../capture/snapshot';
import { PROVIDER_IDS } from './providers';

export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export const CaptureStatusSchema = z.enum(['off', 'paused', 'on']);
export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;

/** How well the page adapter understands the current page. Metadata only, never message text. */
const Count = z.number().int().min(0).max(1_000_000);

export const AdapterHealthSchema = z.object({
  state: z.enum(['ok', 'degraded', 'no_transcript', 'no_conversation']),
  rows: Count,
  extracted: Count,
  unrecognized: Count,
  /** Why rows were skipped. Counts only, never message text. */
  detail: z
    .object({
      noIndex: Count,
      unknownRole: Count,
      duplicateIndex: Count,
      noTextContainer: Count,
      emptyText: Count,
      emptyTextRawChars: z.number().int().min(0).max(100_000_000),
    })
    .optional(),
});
export type AdapterHealth = z.infer<typeof AdapterHealthSchema>;

const ContentReadyMessageSchema = z.object({
  type: z.literal('content.ready'),
  providerId: ProviderIdSchema,
  path: z.string().max(2048),
});

const CaptureGetStateMessageSchema = z.object({
  type: z.literal('capture.getState'),
  providerId: ProviderIdSchema,
});

const CaptureSnapshotMessageSchema = z.object({
  type: z.literal('capture.snapshot'),
  providerId: ProviderIdSchema,
  snapshot: SnapshotSchema,
});

const CaptureHealthMessageSchema = z.object({
  type: z.literal('capture.health'),
  providerId: ProviderIdSchema,
  health: AdapterHealthSchema,
});

/** Every message a content script may send to the service worker. */
export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  ContentReadyMessageSchema,
  CaptureGetStateMessageSchema,
  CaptureSnapshotMessageSchema,
  CaptureHealthMessageSchema,
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

/** Per-tab "page script is alive" record kept in chrome.storage.session. */
export const TabStatusSchema = z.object({
  providerId: ProviderIdSchema,
  path: z.string().max(2048),
  seenAt: z.string().max(40),
});
export type TabStatus = z.infer<typeof TabStatusSchema>;

export const AdapterHealthRecordSchema = AdapterHealthSchema.extend({
  providerId: ProviderIdSchema,
  seenAt: z.string().max(40),
});
export type AdapterHealthRecord = z.infer<typeof AdapterHealthRecordSchema>;

export const tabStatusKey = (tabId: number): string => `tabStatus:${tabId}`;
export const adapterHealthKey = (tabId: number): string => `adapterHealth:${tabId}`;

/** Bumped (in session storage) whenever captured content changes, so the panel can refresh. */
export const CAPTURE_TICK_KEY = 'captureTick';
