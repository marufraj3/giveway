const MAX_TOKEN_LENGTH = 8192;
// Pasted tokens often carry a trailing space, a newline, a non-breaking space or an
// invisible zero-width character. Only the edges are cleaned; anything inside is
// reported instead of being silently removed.
const EDGE_NOISE = /^[\s\u00a0\u200b-\u200d\ufeff]+|[\s\u00a0\u200b-\u200d\ufeff]+$/g;

export function normalizeAccessToken(value: unknown): { token:string; error:string | null } {
  if (typeof value !== 'string') return { token:'', error:'Enter a valid access token.' };
  const token = value.replace(EDGE_NOISE,'');
  if (!token) return { token:'', error:'Enter a valid access token.' };
  if (token.length > MAX_TOKEN_LENGTH) return { token:'', error:'That token is too long to be a Meta access token.' };
  if (/[\s\u200b-\u200d\ufeff]/.test(token)) return { token:'', error:'The token contains spaces or line breaks. Paste it again as one continuous string.' };
  return { token, error:null };
}
