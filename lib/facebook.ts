import type { CommentRecord } from './types';

export function extractPostId(input: string): string | null {
  const value = input.trim();
  if (/^\d+(?:_\d+)?$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !/^(?:www\.|web\.|m\.|mobile\.)?facebook\.com$/i.test(u.hostname)) return null;
    const id = u.searchParams.get('id');
    const story = u.searchParams.get('story_fbid') || u.searchParams.get('fbid');
    if (/^\/(?:story|permalink)\.php\/?$/i.test(u.pathname) && story && /^\d+$/.test(story)) return id && /^\d+$/.test(id) ? `${id}_${story}` : story;
    const parts = u.pathname.split('/').filter(Boolean);
    const at = parts.indexOf('posts');
    if (at >= 1 && /^\d+$/.test(parts[at+1] || '')) return /^\d+$/.test(parts[at-1]) ? `${parts[at-1]}_${parts[at+1]}` : parts[at+1];
    return null;
  } catch { return null; }
}
/**
 * Returns the code of a Facebook post share link (https://www.facebook.com/share/p/<code>/),
 * or null. Parsing only: share links carry no post ID, so the server must resolve them
 * from Facebook's redirect (see lib/share-resolve-core.ts). Safe to use in the browser.
 */
export function sharePostCode(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !/^(?:www\.|web\.|m\.|mobile\.)?facebook\.com$/i.test(u.hostname)) return null;
    if (u.port || u.username || u.password) return null;
    return u.pathname.match(/^\/share\/p\/([A-Za-z0-9_-]{1,64})\/?$/)?.[1] ?? null;
  } catch { return null; }
}
export const isSharePostLink = (input: string) => sharePostCode(input) !== null;
const str = (x:unknown) => typeof x === 'string' ? x : '';
const num = (x:unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
export function mapComment(raw: Record<string, unknown>, parent = ''): CommentRecord {
  const from = raw.from && typeof raw.from === 'object' ? raw.from as Record<string, unknown> : {};
  const date = str(raw.created_time); const parsed = new Date(date);
  return {author:str(from.name), username:str(from.username), text:str(raw.message), likes:num(raw.like_count), replies:num(raw.comment_count), created_at:date && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : '', language:'', is_pinned:false, id:str(raw.id), reply_to_id:parent, avatar_url:'', reaction_count:0, reactions_love:0, reactions_haha:0, reactions_wow:0, reactions_sad:0, reactions_anger:0, reactions_care:0, author_id:str(from.id), author_gender:''};
}
