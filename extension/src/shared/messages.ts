import { z } from 'zod';
import { PROVIDER_IDS } from './providers';

export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export const CaptureStatusSchema = z.enum(['off', 'paused', 'on']);
export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;

const ContentReadyMessageSchema = z.object({
  type: z.literal('content.ready'),
  providerId: ProviderIdSchema,
  path: z.string().max(2048),
});

const CaptureGetStateMessageSchema = z.object({
  type: z.literal('capture.getState'),
  providerId: ProviderIdSchema,
});

/** Every message a content script may send to the service worker. */
export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  ContentReadyMessageSchema,
  CaptureGetStateMessageSchema,
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

/** Per-tab "page script is alive" record kept in chrome.storage.session. */
export const TabStatusSchema = z.object({
  providerId: ProviderIdSchema,
  path: z.string().max(2048),
  seenAt: z.string().max(40),
});
export type TabStatus = z.infer<typeof TabStatusSchema>;

export const tabStatusKey = (tabId: number): string => `tabStatus:${tabId}`;