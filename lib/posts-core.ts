import type { PagePost } from './types';

/** Page posts requested per call; also the "Load more" step in the picker. */
export const PAGE_POSTS_LIMIT = 25;
const MAX_ID_LENGTH = 128;

/** A numeric Graph object ID (`123`) or a composite post ID (`123_456`). */
export function isGraphId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && /^\d+(?:_\d+)?$/.test(value);
}

/** Facebook Page IDs are numeric. */
export function isPageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && /^\d+$/.test(value);
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Maps one object from `/{page-id}/posts` to the fields the post picker needs.
 * Returns null for entries without a usable Graph ID so one malformed item cannot
 * break the whole list.
 */
export function mapPagePost(raw: unknown): PagePost | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const post = raw as Record<string, unknown>;
  if (!isGraphId(post.id)) return null;
  const comments = post.comments && typeof post.comments === 'object' && !Array.isArray(post.comments) ? (post.comments as Record<string, unknown>) : null;
  const summary = comments?.summary && typeof comments.summary === 'object' && !Array.isArray(comments.summary) ? (comments.summary as Record<string, unknown>) : null;
  const total = summary?.total_count;
  return {
    id: post.id,
    message: str(post.message),
    created_time: str(post.created_time),
    // A missing total is not the same as zero comments, so it stays null.
    comment_count: typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.floor(total) : null,
  };
}

export function mapPagePosts(rows: unknown[]): PagePost[] {
  const posts: PagePost[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const post = mapPagePost(row);
    if (post && !seen.has(post.id)) { seen.add(post.id); posts.push(post); }
  }
  return posts;
}
