export const DESTINATION_IDS = ['claude', 'generic'] as const;
export type DestinationId = (typeof DESTINATION_IDS)[number];

export interface DestinationProfile {
  id: DestinationId;
  name: string;
  /** Package size options, in estimated tokens. These are NOT the destination's full context window. */
  budgetOptions: readonly number[];
  defaultBudget: number;
}

export const DESTINATIONS: Record<DestinationId, DestinationProfile> = {
  claude: {
    id: 'claude',
    name: 'Claude (structured tags)',
    budgetOptions: [2000, 4000, 8000, 16000, 32000],
    defaultBudget: 8000,
  },
  generic: {
    id: 'generic',
    name: 'Any chat (plain Markdown)',
    budgetOptions: [1000, 2000, 4000, 8000, 16000],
    defaultBudget: 4000,
  },
};