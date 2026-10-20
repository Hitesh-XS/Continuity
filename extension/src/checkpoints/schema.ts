import { z } from 'zod';

// Limits mirror the Django serializer (objective 2000 chars, snapshot under 256 KB).
export const MAX_LIST_ITEMS = 100;
export const MAX_ITEM_CHARS = 1000;
export const MAX_NOTES_CHARS = 20_000;
export const MAX_SOURCES = 50;

const Item = z.string().trim().min(1).max(MAX_ITEM_CHARS);
const ItemList = z.array(Item).max(MAX_LIST_ITEMS);

export const CreateCheckpointInputSchema = z.object({
  objective: z.string().trim().min(1).max(2000),
  nextAction: z.string().trim().min(1).max(2000),
  decisions: ItemList.default([]),
  completed: ItemList.default([]),
  blockers: ItemList.default([]),
  notes: z.string().trim().max(MAX_NOTES_CHARS).default(''),
  /** Captured conversations to link as sources. The repository computes the details. */
  conversationIds: z.array(z.string().min(1).max(200)).max(MAX_SOURCES).default([]),
});

export type CreateCheckpointInput = z.input<typeof CreateCheckpointInputSchema>;

/** Turns textarea text into a clean list: one item per line, bullet markers removed. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((line) => line !== '');
}