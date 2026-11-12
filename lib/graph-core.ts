const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '') ? process.env.META_GRAPH_API_VERSION : 'v26.0';
export class GraphError extends Error { constructor(public code:string, message:string, public status=400, public retryable=false, public retryAfter=0) { super(message); } }
type GraphResponse = { [key:string]: unknown; data?: unknown; paging?: {next?:unknown; cursors?:{after?:unknown}}; error?:{code?:unknown} };
export async function graph(path:string, token:string, params:Record<string,string> = {}) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
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
    if (code === 190) throw new GraphError('TOKEN', 'The access token is invalid or expired. Check it and reconnect.', 401);
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
