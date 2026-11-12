import { createHmac } from 'node:crypto';

const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '') ? process.env.META_GRAPH_API_VERSION : 'v26.0';
export class GraphError extends Error { constructor(public code:string, message:string, public status=400, public retryable=false, public retryAfter=0) { super(message); } }
type GraphErrorDetail = { code?:unknown; error_subcode?:unknown; message?:unknown; type?:unknown };
type GraphResponse = { [key:string]: unknown; data?: unknown; paging?: {next?:unknown; cursors?:{after?:unknown}}; error?:GraphErrorDetail };
let warnedAboutAppSecret = false;

/**
 * Meta's own error text is the only way to tell "expired" apart from "issued for
 * another app", "session logged out" or "appsecret_proof required". It is trimmed,
 * capped and stripped of anything token-like before it can reach a browser.
 */
export function sanitizeGraphDetail(detail: unknown, token: string): string {
  if (typeof detail !== 'string') return '';
  let text = detail;
  if (token.length >= 3) text = text.split(token).join('[redacted]');
  text = text
    .replace(/access_token=[^&\s]+/gi,'access_token=[redacted]')
    .replace(/appsecret_proof=[^&\s]+/gi,'appsecret_proof=[redacted]')
    .replace(/\bEA[A-Za-z0-9_-]{10,}\b/g,'[redacted]');
  return text.replace(/\s+/g,' ').trim().slice(0,220);
}

const TOKEN_SUBCODE_REASONS: Record<number,string> = {
  458: 'Meta says this token was not issued for the app being called, or the user has not authorized that app.',
  459: 'Meta requires the user to log in again before this token works (checkpoint).',
  460: 'Meta invalidated this token because the account password changed.',
  463: 'Meta reports that this token has expired.',
  464: 'Meta reports that the user account is unconfirmed.',
  467: 'Meta reports that this token is invalid.',
  492: 'Meta invalidated the session because the user logged out or it expired.',
};

/** Turns a Meta code-190 response into a specific reason instead of guessing "expired". */
export function tokenFailureMessage(error: GraphErrorDetail | undefined, token: string): string {
  const subcode = Number(error?.error_subcode);
  const detail = sanitizeGraphDetail(error?.message, token);
  const needsProof = /appsecret_proof/i.test(detail);
  const reason = needsProof
    ? 'Meta says this app requires an appsecret_proof with every call. Set META_APP_SECRET on the server (Meta app dashboard → Settings → Basic), or use a token from an app that does not require it.'
    : TOKEN_SUBCODE_REASONS[subcode] || 'Meta rejected this token as invalid, expired, or issued for a different app.';
  const evidence = detail ? ` Meta said: "${detail}".` : '';
  return `${reason}${evidence} Check the token, the Meta app that issued it and its permissions, then reconnect.`;
}

export async function graph(path:string, token:string, params:Record<string,string> = {}) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  // Apps with "Require App Secret" enabled reject calls without an appsecret_proof.
  // The proof is an HMAC derived from the token, never the token itself.
  const appSecret = (process.env.META_APP_SECRET || '').trim();
  if (appSecret) {
    if (/^[0-9a-f]{32}$/i.test(appSecret)) url.searchParams.set('appsecret_proof', createHmac('sha256', appSecret).update(token).digest('hex'));
    else if (!warnedAboutAppSecret) {
      warnedAboutAppSecret = true;
      console.warn('[threadline] META_APP_SECRET is not a 32-character hex app secret; appsecret_proof was not sent.');
    }
  }
  let response:Response;
  try { response = await fetch(url, {headers:{Authorization:`Bearer ${token}`}, cache:'no-store', signal:AbortSignal.timeout(20000)}); }
  catch { throw new GraphError('NETWORK', 'Could not reach Meta or the request timed out. Retry this batch.', 503, true); }
  let data: GraphResponse; // Individual response fields are checked at the route boundary.
  try { data = await response.json(); } catch { throw new GraphError('RESPONSE', 'Meta returned an unexpected response. Retry this batch.', 502, true); }
  if (!response.ok || data?.error) {
    const code = Number(data?.error?.code);
    if ([4,17,32,613].includes(code) || response.status === 429) {
      const header = response.headers.get('retry-after');
      const seconds = header ? (Number.isFinite(Number(header)) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000)) : 0;
      throw new GraphError('RATE_LIMIT', 'Meta rate limit reached. Wait before retrying or resume manually.', 429, true, Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0);
    }
    if (code === 190) throw new GraphError('TOKEN', tokenFailureMessage(data?.error, token), 401);
    if ([10,200,100].includes(code)) throw new GraphError('ACCESS', 'Meta could not access this object or field. Check the ID, Page token, permissions and app access.', 403);
    throw new GraphError('GRAPH', 'Meta could not complete this request. Check access and try again.', response.status >= 500 ? 502 : 400, response.status >= 500);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new GraphError('RESPONSE','Meta returned an unexpected response.',502,true);
  return data;
}
export function nextCursor(data:GraphResponse): string | null {
  if (!data.paging?.next) return null;
  const after = data.paging?.cursors?.after;
  if (typeof after !== 'string' || !after || after.length > 4096) throw new GraphError('CURSOR','Meta indicated another page but did not supply a usable cursor. The scrape is incomplete.',502);
  return after;
}
