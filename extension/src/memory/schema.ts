import { z } from 'zod';
import { MEMORY_KINDS, MEMORY_STATUSES } from './types';

export const MAX_TEXT = 1000;
export const MAX_TOPIC = 100;
export const MAX_EVIDENCE = 20;

const Text = z.string().trim().min(1).max(MAX_TEXT);
const Topic = z.string().trim().max(MAX_TOPIC);
const EvidenceIds = z.array(z.string().min(1).max(300)).max(MAX_EVIDENCE);

export const CreateMemoryInputSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  text: Text,
  topic: Topic.default(''),
  status: z.enum(MEMORY_STATUSES).optional(),
  evidenceMessageIds: EvidenceIds.default([]),
});

export const UpdateMemoryInputSchema = z
  .object({ text: Text.optional(), topic: Topic.optional() })
  .refine((value) => value.text !== undefined || value.topic !== undefined, {
    message: 'Nothing to change.',
  });

export const SupersedeInputSchema = z.object({
  text: Text,
  topic: Topic.optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  evidenceMessageIds: EvidenceIds.default([]),
});

export type CreateMemoryInput = z.input<typeof CreateMemoryInputSchema>;