import { z } from 'zod';

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'unknown'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

// Captured text is untrusted input from a web page: bound everything.
export const MAX_MESSAGES_PER_SNAPSHOT = 2000;
export const MAX_MESSAGE_CHARS = 200_000;
export const MAX_SNAPSHOT_CHARS = 4_000_000;
export const MAX_MESSAGE_INDEX = 1_000_000;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

export const SnapshotMessageSchema = z.object({
  /** A stable per-message key from the page, if it has one. */
  key: z.string().regex(KEY_PATTERN).optional(),
  /** The message's absolute position in the conversation, when the page provides one. */
  index: z.number().int().min(0).max(MAX_MESSAGE_INDEX).optional(),
  role: z.enum(MESSAGE_ROLES),
  text: z.string().max(MAX_MESSAGE_CHARS),
});

export const SnapshotSchema = z
  .object({
    externalConversationId: z.string().regex(ID_PATTERN),
    title: z.string().max(300).optional(),
    messages: z.array(SnapshotMessageSchema).min(1).max(MAX_MESSAGES_PER_SNAPSHOT),
  })
  .superRefine((snapshot, ctx) => {
    const seenKeys = new Set<string>();
    const seenIndexes = new Set<number>();
    let total = 0;
    snapshot.messages.forEach((message, position) => {
      total += message.text.length;
      if (message.key !== undefined) {
        if (seenKeys.has(message.key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['messages', position, 'key'],
            message: 'Duplicate message key.',
          });
        }
        seenKeys.add(message.key);
      }
      if (message.index !== undefined) {
        if (seenIndexes.has(message.index)) {
          ctx.addIssue({
            code: 'custom',
            path: ['messages', position, 'index'],
            message: 'Duplicate message index.',
          });
        }
        seenIndexes.add(message.index);
      }
    });
    if (total > MAX_SNAPSHOT_CHARS) {
      ctx.addIssue({ code: 'custom', message: 'Snapshot is too large.' });
    }
  });

export type Snapshot = z.infer<typeof SnapshotSchema>;

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}