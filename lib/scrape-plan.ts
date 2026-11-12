/** Hard cap on posts per scrape, so one start cannot queue an unbounded job. */
export const MAX_POSTS_PER_SCRAPE = 50;
const MAX_INPUT_LENGTH = 2048;

/**
 * Splits pasted text into candidate post inputs. One per line is the documented
 * form; commas and spaces are accepted too because post IDs are often pasted in
 * lists. Duplicates are removed while keeping the first occurrence.
 */
export function splitPostInputs(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const value = part.trim();
    if (value && value.length <= MAX_INPUT_LENGTH) seen.add(value);
  }
  return Array.from(seen);
}

export interface PartitionedInputs {
  valid: string[];
  invalid: string[];
  truncated: boolean;
}

/**
 * Splits pasted text and classifies each entry as supported or not, using the same
 * rules as the input field. Nothing is resolved here: share links stay share links
 * until the server resolves them.
 */
export function partitionPostInputs(text: string, isSupported: (value: string) => boolean, max = MAX_POSTS_PER_SCRAPE): PartitionedInputs {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const value of splitPostInputs(text)) (isSupported(value) ? valid : invalid).push(value);
  return { valid: valid.slice(0, max), invalid, truncated: valid.length > max };
}

export interface PlannedTargets {
  inputs: string[];
  truncated: boolean;
}

/** Combines picked posts with pasted inputs, de-duplicated and capped. */
export function planTargets(selectedIds: string[], manualInputs: string[], max = MAX_POSTS_PER_SCRAPE): PlannedTargets {
  const seen = new Set<string>();
  for (const value of [...selectedIds, ...manualInputs]) {
    const trimmed = value.trim();
    if (trimmed && trimmed.length <= MAX_INPUT_LENGTH) seen.add(trimmed);
  }
  const all = Array.from(seen);
  return { inputs: all.slice(0, max), truncated: all.length > max };
}
