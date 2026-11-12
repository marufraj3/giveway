import { extractPostId, isSharePostLink, sharePostCode } from './facebook';

/** Maximum redirects inspected per share link (and therefore maximum HTTP requests). */
export const SHARE_RESOLVE_MAX_REDIRECTS = 5;
/** One deadline for the whole redirect chain, so every hop together stays bounded. */
export const SHARE_RESOLVE_TIMEOUT_MS = 6000;

const MAX_LOCATION_LENGTH = 4096;
// Exact host allowlist for every request and redirect hop. No suffix matching, so
// lookalikes (facebook.com.evil.test, evilfacebook.com), IP literals, localhost,
// graph.facebook.com and the l.facebook.com link shim are all rejected.
const ALLOWED_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'mobile.facebook.com']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MANUAL = 'Enter the numeric post ID manually.';

export class ShareResolveError extends Error {
  constructor(public code: string, message: string, public status = 422, public retryable = false) { super(message); }
}

export interface ShareResolveOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** HTTPS, default port, no credentials and an exact allowlisted Facebook host. */
export function isAllowedShareResolveUrl(u: URL): boolean {
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && ALLOWED_HOSTS.has(u.hostname);
}

function postIdFromUrl(u: URL): string | null {
  const id = extractPostId(u.href);
  if (id) return id;
  // A bare PAGEID_POSTID path is an unambiguous numeric Graph post ID. A single bare
  // number is not accepted because it usually names a profile or Page, not a post.
  return u.pathname.match(/^\/(\d+_\d+)\/?$/)?.[1] ?? null;
}

const usesPfbid = (u: URL) =>
  /\/(?:posts|permalink)\/pfbid[0-9A-Za-z]+/i.test(u.pathname) ||
  /^pfbid[0-9A-Za-z]+$/i.test(u.searchParams.get('story_fbid') || u.searchParams.get('fbid') || '');

const isLoginWall = (u: URL) => /^\/(?:login(?:\.php)?|checkpoint)(?:\/|$)/i.test(u.pathname);

/** The `next` target of a login redirect, parsed (never requested) and allowlist-checked. */
function loginNextUrl(u: URL): URL | null {
  const next = u.searchParams.get('next');
  if (!next || next.length > MAX_LOCATION_LENGTH) return null;
  try {
    const target = new URL(next, u);
    return isAllowedShareResolveUrl(target) ? target : null;
  } catch { return null; }
}

const timeoutError = () => new ShareResolveError('SHARE_TIMEOUT',
  'Facebook didn’t respond in time while resolving this share link. Try again, or enter the numeric post ID manually.', 504, true);

const pfbidError = () => new ShareResolveError('SHARE_PFBID',
  `Facebook resolved this share link to a post URL with an obfuscated “pfbid” identifier instead of a numeric post ID, so it can’t be used with the Graph API here. ${MANUAL}`);

function describePath(u: URL): string {
  if (u.pathname === '/') return 'the Facebook home page';
  return `“${u.pathname.length > 80 ? `${u.pathname.slice(0, 80)}…` : u.pathname}”`;
}

/**
 * Resolve a Facebook /share/p/... link to a numeric Graph post ID using only Facebook's
 * HTTP redirect, entirely server-side.
 *
 * - The first request always goes to https://www.facebook.com/share/p/<code>/ (the user's
 *   query string, fragment and host variant are dropped).
 * - Redirects are followed manually: every Location must be HTTPS on an exact
 *   allowlisted Facebook host (default port, no credentials) before it is used, which
 *   prevents SSRF. Only further share links are requested; post URLs, login pages and
 *   anything else are inspected without being requested.
 * - At most SHARE_RESOLVE_MAX_REDIRECTS redirects, within one SHARE_RESOLVE_TIMEOUT_MS deadline.
 * - No access token, Authorization header or cookie is ever sent (this function does not
 *   accept a token), and response bodies are never read: no HTML scraping, browser
 *   automation or private endpoints.
 * - When no supported post URL or numeric ID can be read from the redirect, a
 *   ShareResolveError explains why so the user can enter the numeric post ID manually.
 */
export async function resolveSharePostId(input: string, options: ShareResolveOptions = {}): Promise<string> {
  const code = sharePostCode(input);
  if (!code) throw new ShareResolveError('SHARE_INVALID', `This isn’t a supported Facebook share link (https://www.facebook.com/share/p/…). ${MANUAL}`, 400);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxRedirects = options.maxRedirects ?? SHARE_RESOLVE_MAX_REDIRECTS;
  // One deadline for the whole chain. An explicit timer (cleared in `finally`) rather than
  // AbortSignal.timeout(), so nothing lingers after resolution and the timer reliably fires.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.timeoutMs ?? SHARE_RESOLVE_TIMEOUT_MS);
  try {
    return await followShareRedirects(new URL(`https://www.facebook.com/share/p/${code}/`), fetchImpl, maxRedirects, deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function followShareRedirects(start: URL, fetchImpl: typeof fetch, maxRedirects: number, signal: AbortSignal): Promise<string> {
  let current = start;
  for (let redirects = 1; ; redirects++) {
    // Enforced on every hop as well, not only through fetch's own abort handling.
    if (signal.aborted) throw timeoutError();
    let response: Response;
    try {
      response = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        headers: { accept: 'text/html' },
        signal,
      });
    } catch {
      if (signal.aborted) throw timeoutError();
      throw new ShareResolveError('SHARE_NETWORK', `Couldn’t reach Facebook to resolve this share link. Try again, or enter the numeric post ID manually.`, 502, true);
    }

    const status = response.status;
    const location = response.headers.get('location');
    // Only the status and Location header are used; discard the body unread.
    try { response.body?.cancel().catch(() => undefined); } catch { /* already closed */ }

    if (!REDIRECT_STATUSES.has(status)) {
      if (status >= 200 && status < 300) throw new ShareResolveError('SHARE_NO_REDIRECT', `Facebook didn’t redirect this share link to a post URL, so no post ID could be read. The post may require a login, be private or deleted, or Facebook may not reveal it to anonymous requests. ${MANUAL}`);
      const retryable = status === 429 || status >= 500;
      throw new ShareResolveError('SHARE_HTTP_ERROR', `Facebook returned HTTP ${status} while resolving this share link. ${retryable ? 'Try again later, or enter the numeric post ID manually.' : MANUAL}`, 502, retryable);
    }
    if (!location || location.length > MAX_LOCATION_LENGTH) throw new ShareResolveError('SHARE_NO_LOCATION', `Facebook sent a redirect without a usable destination, so no post ID could be read. ${MANUAL}`);

    let target: URL;
    try { target = new URL(location, current); } catch { throw new ShareResolveError('SHARE_BAD_REDIRECT', `Facebook sent an invalid redirect URL, so no post ID could be read. ${MANUAL}`); }
    if (!isAllowedShareResolveUrl(target)) throw new ShareResolveError('SHARE_UNSAFE_REDIRECT', `This share link redirected outside the approved Facebook hosts (or to a non-HTTPS URL, custom port or embedded credentials). The redirect was blocked and not followed. ${MANUAL}`);

    const id = postIdFromUrl(target);
    if (id) return id;
    if (isLoginWall(target)) {
      // Facebook sometimes names the destination in `next`; it is parsed, never requested.
      const next = loginNextUrl(target);
      const nextId = next && postIdFromUrl(next);
      if (nextId) return nextId;
      if (next && usesPfbid(next)) throw pfbidError();
      throw new ShareResolveError('SHARE_LOGIN_REQUIRED', `Facebook redirected this share link to a login page instead of the post. This app doesn’t sign in to Facebook or use cookies, so the post ID can’t be read from this link. ${MANUAL}`);
    }
    if (usesPfbid(target)) throw pfbidError();
    if (!isSharePostLink(target.href)) throw new ShareResolveError('SHARE_UNSUPPORTED_TARGET', `Facebook redirected this share link to ${describePath(target)}, which isn’t a supported post URL format. ${MANUAL}`);
    if (redirects >= maxRedirects) throw new ShareResolveError('SHARE_TOO_MANY_REDIRECTS', `This share link was still redirecting after ${maxRedirects} redirects without reaching a post URL, so resolution stopped. ${MANUAL}`);
    current = target;
  }
}

/**
 * Turn user input into a Graph post ID. Numeric IDs and supported post URLs are parsed
 * locally exactly as before (no network request). Only /share/p/ links trigger
 * resolveSharePostId. Returns null for anything else.
 */
export async function resolvePostInput(input: string, options?: ShareResolveOptions): Promise<string | null> {
  const id = extractPostId(input);
  if (id) return id;
  return isSharePostLink(input) ? resolveSharePostId(input, options) : null;
}
