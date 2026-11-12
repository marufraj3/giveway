import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {GraphError, graph} from '../lib/graph-core';

const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = 'EAABtokenvalue1234567890';
type Call = {url:string; init:RequestInit};

function captureFetch(body: unknown, status = 200) {
  const calls:Call[] = [];
  globalThis.fetch = (async (input:RequestInfo | URL, init:RequestInit = {}) => {
    calls.push({url:String(input), init});
    return new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  return calls;
}

function withSecret(value: string | undefined, run: () => Promise<void>) {
  const previous = process.env.META_APP_SECRET;
  if (value === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = value;
  return run().finally(() => {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  });
}

test('sends a derived appsecret_proof when META_APP_SECRET is configured', async () => {
  await withSecret(SECRET, async () => {
    const calls = captureFetch({id:'1'});
    await graph('me',TOKEN,{fields:'id'});
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('appsecret_proof'),createHmac('sha256',SECRET).update(TOKEN).digest('hex'));
    assert.equal(url.hostname,'graph.facebook.com');
    assert.ok(!calls[0].url.includes(TOKEN));
    assert.equal((calls[0].init.headers as Record<string,string>).Authorization,`Bearer ${TOKEN}`);
  });
});

test('sends no appsecret_proof without a secret or with a malformed one', async () => {
  await withSecret(undefined, async () => {
    const calls = captureFetch({id:'1'});
    await graph('me',TOKEN,{fields:'id'});
    assert.equal(new URL(calls[0].url).searchParams.get('appsecret_proof'),null);
  });
  await withSecret('not-a-secret', async () => {
    const warn = console.warn; console.warn = () => {};
    try {
      const calls = captureFetch({id:'1'});
      await graph('me',TOKEN,{fields:'id'});
      assert.equal(new URL(calls[0].url).searchParams.get('appsecret_proof'),null);
    } finally { console.warn = warn; }
  });
});

async function tokenError(body: unknown): Promise<GraphError> {
  captureFetch(body, 400);
  try {
    await graph('me',TOKEN,{fields:'id,name'});
  } catch (error) {
    assert.ok(error instanceof GraphError);
    return error;
  }
  throw new Error('expected a GraphError');
}

test('a code 190 response is explained instead of always "expired"', async () => {
  const expired = await tokenError({error:{code:190, error_subcode:463, message:'Session has expired.'}});
  assert.equal(expired.code,'TOKEN');
  assert.equal(expired.status,401);
  assert.match(expired.message,/expired/i);

  const otherApp = await tokenError({error:{code:190, error_subcode:458, message:'User has not authorized application.'}});
  assert.match(otherApp.message,/not issued for the app|has not authorized/);

  const loggedOut = await tokenError({error:{code:190, error_subcode:492, message:'The session is invalid because the user logged out.'}});
  assert.match(loggedOut.message,/logged out/i);

  const unknown = await tokenError({error:{code:190, message:'Invalid OAuth access token.'}});
  assert.match(unknown.message,/Meta said: "Invalid OAuth access token\."/);
});

test('an appsecret_proof rejection points at META_APP_SECRET', async () => {
  const error = await tokenError({error:{code:190, message:'API calls from the server require an appsecret_proof argument'}});
  assert.match(error.message,/META_APP_SECRET/);
});

test('Meta detail never echoes the token or token-like values', async () => {
  const error = await tokenError({error:{code:190, message:`Invalid OAuth access token: ${TOKEN} (access_token=${TOKEN})`}});
  assert.ok(!error.message.includes(TOKEN));
  assert.match(error.message,/\[redacted\]/);
  const other = await tokenError({error:{code:190, message:'Bad token EAABabcdefghij1234567890 supplied'}});
  assert.ok(!other.message.includes('EAABabcdefghij1234567890'));
});

test('the appsecret_proof never contains the app secret itself', async () => {
  await withSecret(SECRET, async () => {
    const calls = captureFetch({id:'1'});
    await graph('me',TOKEN,{fields:'id'});
    assert.ok(!calls[0].url.includes(SECRET));
  });
});
