/** Conservative for prose, about right for code. Real tokenizers differ by model: this is an estimate. */
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}