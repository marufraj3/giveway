import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPostId, isSharePostLink, sharePostCode} from '../lib/facebook';
import {graph} from '../lib/graph-core';
import {SHARE_RESOLVE_MAX_REDIRECTS, ShareResolveError, resolvePostInput, resolveSharePostId} from '../lib/share-resolve-core';

const SHARE = 'https://www.facebook.com/share/p/1QRxGLCoso/';
type Call = {url:string; init:RequestInit};
type Reply = Response | Error | ((call:Call) => Response | Promise<Response>);

/** Mock fetch that serves queued replies in order and records every request it receives. */
function mockFetch(...replies:Reply[]) {
  const calls:Call[] = [];
  const fetchImpl = (async (input:RequestInfo | URL, init:RequestInit = {}) => {
    const call = {url:String(input), init};
    calls.push(call);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request to ${call.url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  }) as typeof fetch;
  return {calls, fetchImpl};
}
const redirect = (location:string, status = 302) => new Response(null, {status, headers:{location}});
const fails = (code:string) => (err:unknown) => err instanceof ShareResolveError && err.code === code && err.message.includes('numeric post ID manually');
/** Fetch that never answers until its abort signal fires, like a hung connection. */
const hang = ({init}:Call) => new Promise<Response>((_, reject) => {
  const signal = init.signal;
  if (!signal) return reject(new Error('request sent without a timeout signal'));
  signal.addEventListener('abort', () => reject(signal.reason), {once:true});
});

test('share links are detected by parsing only, with strict host, scheme and path checks', () => {
  assert.equal(sharePostCode(SHARE), '1QRxGLCoso');
  assert.ok(isSharePostLink('https://m.facebook.com/share/p/1QRxGLCoso?mibextid=WC7FNe'));
  assert.ok(isSharePostLink('  https://facebook.com/share/p/abc_D-1/  '));
  for (const bad of [
    'http://www.facebook.com/share/p/abc/', 'https://facebook.com.evil.test/share/p/abc/', 'https://evilfacebook.com/share/p/abc/',
    'https://www.facebook.com:8443/share/p/abc/', 'https://user:pw@www.facebook.com/share/p/abc/', 'https://l.facebook.com/share/p/abc/',
    'https://www.facebook.com/share/v/abc/', 'https://www.facebook.com/share/p/', 'https://www.facebook.com/share/p/abc/extra',
    'https://www.facebook.com/share/p/a%2Fb/', '123_456', 'not a url',
  ]) assert.equal(isSharePostLink(bad), false, bad);
  // Local extraction stays syntactic: a share link carries no post ID by itself.
  assert.equal(extractPostId(SHARE), null);
});

test('existing numeric IDs and supported post URLs still resolve locally without any network request', async () => {
  const {calls, fetchImpl} = mockFetch();
  assert.equal(await resolvePostInput('123_456', {fetchImpl}), '123_456');
  assert.equal(await resolvePostInput('456', {fetchImpl}), '456');
  assert.equal(await resolvePostInput('https://www.facebook.com/123/posts/456/', {fetchImpl}), '123_456');
  assert.equal(await resolvePostInput('https://facebook.com/example/posts/456', {fetchImpl}), '456');
  assert.equal(await resolvePostInput('https://m.facebook.com/story.php?story_fbid=456&id=123', {fetchImpl}), '123_456');
  assert.equal(await resolvePostInput('https://facebook.com/permalink.php?fbid=456&id=123', {fetchImpl}), '123_456');
  assert.equal(await resolvePostInput('https://facebook.com.evil.test/share/p/abc', {fetchImpl}), null);
  assert.equal(await resolvePostInput('https://www.facebook.com/share/v/abc/', {fetchImpl}), null);
  assert.equal(await resolvePostInput('not a link', {fetchImpl}), null);
  assert.equal(calls.length, 0);
});

test('successful redirect to a supported post URL yields its Graph post ID', async () => {
  const {calls, fetchImpl} = mockFetch(redirect(`https://www.facebook.com/123/posts/456/?rdid=r1&share_url=${encodeURIComponent(SHARE)}`));
  assert.equal(await resolveSharePostId('https://m.facebook.com/share/p/1QRxGLCoso?mibextid=WC7FNe#x', {fetchImpl}), '123_456');
  assert.equal(calls.length, 1);
  // Canonical first request: fixed www host, user query string and fragment dropped.
  assert.equal(calls[0].url, SHARE);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('authorization'), null);
  assert.equal(headers.get('cookie'), null);
});

test('successful redirects: other supported URL shapes, relative Locations and a bounded share-link chain', async () => {
  const cases:[Response, string][] = [
    [redirect('https://www.facebook.com/permalink.php?story_fbid=456&id=123&rdid=x', 301), '123_456'],
    [redirect('https://m.facebook.com/story.php?story_fbid=456&id=123', 303), '123_456'],
    [redirect('https://web.facebook.com/groups/789/posts/1011/', 307), '789_1011'],
    [redirect('/123_456', 308), '123_456'],
    [redirect(`https://www.facebook.com/login/?next=${encodeURIComponent('https://www.facebook.com/story.php?story_fbid=456&id=123')}`), '123_456'],
  ];
  for (const [response, id] of cases) {
    const {calls, fetchImpl} = mockFetch(response);
    assert.equal(await resolveSharePostId(SHARE, {fetchImpl}), id);
    assert.equal(calls.length, 1, 'post URLs and login pages are inspected, never requested');
  }
  const {calls, fetchImpl} = mockFetch(redirect('https://m.facebook.com/share/p/1QRxGLCoso/', 301), redirect('/permalink.php?story_fbid=456&id=123'));
  assert.equal(await resolveSharePostId(SHARE, {fetchImpl}), '123_456');
  assert.deepEqual(calls.map(c => c.url), [SHARE, 'https://m.facebook.com/share/p/1QRxGLCoso/']);
});

test('failed redirects give a clear reason and keep the manual post ID path', async () => {
  const cases:[Reply, string, RegExp][] = [
    [new Response('<html>login</html>', {status:200}), 'SHARE_NO_REDIRECT', /didn’t redirect/],
    [new Response(null, {status:302}), 'SHARE_NO_LOCATION', /without a usable destination/],
    [redirect('https://www.facebook.com/someone/posts/pfbid02AbCdEf/?rdid=x'), 'SHARE_PFBID', /pfbid/],
    [redirect('https://www.facebook.com/permalink.php?story_fbid=pfbid0xyz&id=123'), 'SHARE_PFBID', /pfbid/],
    [redirect(`https://www.facebook.com/login.php?next=${encodeURIComponent('https://www.facebook.com/someone/posts/pfbid0abc')}`), 'SHARE_PFBID', /pfbid/],
    [redirect(`https://www.facebook.com/login/?next=${encodeURIComponent(SHARE)}`), 'SHARE_LOGIN_REQUIRED', /login page/],
    [redirect('https://www.facebook.com/checkpoint/block/'), 'SHARE_LOGIN_REQUIRED', /login page/],
    [redirect('https://www.facebook.com/watch/?v=123'), 'SHARE_UNSUPPORTED_TARGET', /“\/watch\/”/],
    [redirect('https://www.facebook.com/'), 'SHARE_UNSUPPORTED_TARGET', /home page/],
    [new Response('missing', {status:404}), 'SHARE_HTTP_ERROR', /HTTP 404/],
    [new TypeError('fetch failed'), 'SHARE_NETWORK', /Couldn’t reach Facebook/],
  ];
  for (const [reply, code, message] of cases) {
    const {calls, fetchImpl} = mockFetch(reply);
    await assert.rejects(resolveSharePostId(SHARE, {fetchImpl}), (err:unknown) => fails(code)(err) && message.test((err as Error).message), code);
    assert.equal(calls.length, 1, `${code} must not trigger further requests`);
  }
  const {fetchImpl} = mockFetch(new Response(null, {status:503}));
  await assert.rejects(resolveSharePostId(SHARE, {fetchImpl}), (err:unknown) => fails('SHARE_HTTP_ERROR')(err) && (err as ShareResolveError).retryable);
});

test('redirect loops stop at the redirect limit', async () => {
  const calls:string[] = [];
  // Yields to the event loop like real I/O, so a missing limit would fail on the deadline instead of hanging.
  const loop = (async (input:RequestInfo | URL) => { calls.push(String(input)); await new Promise(resolve => setImmediate(resolve)); return redirect(SHARE); }) as typeof fetch;
  await assert.rejects(resolveSharePostId(SHARE, {fetchImpl:loop}), fails('SHARE_TOO_MANY_REDIRECTS'));
  assert.equal(calls.length, SHARE_RESOLVE_MAX_REDIRECTS);
  calls.length = 0;
  await assert.rejects(resolveSharePostId(SHARE, {fetchImpl:loop, maxRedirects:2}), fails('SHARE_TOO_MANY_REDIRECTS'));
  assert.equal(calls.length, 2);
});

test('unsafe redirect targets are blocked and never requested (SSRF protection)', async () => {
  for (const location of [
    'https://evil.test/123/posts/456/', 'https://facebook.com.evil.test/123/posts/456/', 'https://evilfacebook.com/share/p/abc/',
    'http://www.facebook.com/123/posts/456/', '//evil.test/123/posts/456/', 'https://127.0.0.1/share/p/abc/', 'https://[::1]/share/p/abc/',
    'https://localhost/share/p/abc/', 'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.1/123/posts/456/',
    'https://www.facebook.com:8443/123/posts/456/', 'https://user:pass@www.facebook.com/123/posts/456/',
    'https://graph.facebook.com/v26.0/123_456', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.test', 'javascript:alert(1)', 'file:///etc/passwd',
  ]) {
    const {calls, fetchImpl} = mockFetch(redirect(location));
    await assert.rejects(resolveSharePostId(SHARE, {fetchImpl}), fails('SHARE_UNSAFE_REDIRECT'), location);
    assert.equal(calls.length, 1, `must not request ${location}`);
  }
  // Unsafe hop after a valid one in a chain is blocked too.
  const {calls, fetchImpl} = mockFetch(redirect('https://m.facebook.com/share/p/1QRxGLCoso/'), redirect('https://evil.test/share/p/1QRxGLCoso/'));
  await assert.rejects(resolveSharePostId(SHARE, {fetchImpl}), fails('SHARE_UNSAFE_REDIRECT'));
  assert.deepEqual(calls.map(c => new URL(c.url).hostname), ['www.facebook.com', 'm.facebook.com']);
  // Unsafe or non-share input is rejected before any request.
  for (const input of ['https://evil.test/share/p/abc/', 'http://www.facebook.com/share/p/abc/', 'https://www.facebook.com:8443/share/p/abc/', 'https://169.254.169.254/share/p/abc/', 'https://www.facebook.com/123/posts/456/']) {
    const {calls, fetchImpl} = mockFetch();
    await assert.rejects(resolveSharePostId(input, {fetchImpl}), fails('SHARE_INVALID'), input);
    assert.equal(calls.length, 0);
  }
});

test('a hanging Facebook request times out with a retryable, explained error', async () => {
  const {calls, fetchImpl} = mockFetch(hang);
  const started = Date.now();
  await assert.rejects(resolveSharePostId(SHARE, {fetchImpl, timeoutMs:50}), (err:unknown) => fails('SHARE_TIMEOUT')(err) && (err as ShareResolveError).retryable);
  assert.ok(Date.now() - started < 2000);
  assert.equal(calls.length, 1);
  // One deadline covers the whole chain, not each hop separately.
  const slow = mockFetch(async () => { await new Promise(resolve => setTimeout(resolve, 40)); return redirect('https://m.facebook.com/share/p/1QRxGLCoso/'); }, hang);
  const chainStarted = Date.now();
  await assert.rejects(resolveSharePostId(SHARE, {fetchImpl:slow.fetchImpl, timeoutMs:80}), fails('SHARE_TIMEOUT'));
  assert.ok(Date.now() - chainStarted < 2000);
  assert.equal(slow.calls.length, 2);
});

test('the access token goes only to Graph in the Authorization header, never to share-link resolution', async () => {
  const TOKEN = 'EAAB-SECRET-TOKEN';
  const original = globalThis.fetch;
  const calls:{url:string; init?:RequestInit}[] = [];
  try {
    globalThis.fetch = (async (input:RequestInfo | URL, init?:RequestInit) => {
      const url = String(input);
      calls.push({url, init});
      if (new URL(url).hostname === 'graph.facebook.com') return new Response(JSON.stringify({id:'123_456', message:'hi', created_time:''}), {status:200});
      return redirect('https://www.facebook.com/123/posts/456/');
    }) as typeof fetch;
    const id = await resolvePostInput(SHARE);
    assert.equal(id, '123_456');
    assert.equal((await graph(id ?? '', TOKEN, {fields:'id,message,created_time'})).id, '123_456');
  } finally { globalThis.fetch = original; }
  assert.equal(calls.length, 2);
  const [share, graphCall] = calls;
  assert.equal(new URL(share.url).hostname, 'www.facebook.com');
  assert.ok(!share.url.includes(TOKEN));
  for (const [name, value] of new Headers(share.init?.headers)) assert.ok(!value.includes(TOKEN), name);
  assert.equal(new Headers(share.init?.headers).get('authorization'), null);
  assert.ok(graphCall.url.startsWith('https://graph.facebook.com/') && !graphCall.url.includes(TOKEN));
  assert.equal((graphCall.init?.headers as Record<string,string>).Authorization, `Bearer ${TOKEN}`);
});
