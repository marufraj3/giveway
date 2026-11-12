import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import type {CommentRecord} from '../lib/types';

/** The API contract used by the hook: the route's JSON, not raw Graph output. */
type Reply = {status?:number; body:unknown};
type Handler = (body:Record<string, unknown>) => Reply;
type Call = {action:string; body:Record<string, unknown>};
let routes:Record<string, Handler> = {};
let calls:Call[] = [];

const record = (id:string, replyTo = ''):CommentRecord => ({
  author:'Author', username:'', text:`text ${id}`, likes:0, replies:0, created_at:'2024-01-01T00:00:00.000Z',
  language:'', is_pinned:false, id, reply_to_id:replyTo, avatar_url:'', reaction_count:0, reactions_love:0,
  reactions_haha:0, reactions_wow:0, reactions_sad:0, reactions_anger:0, reactions_care:0, author_id:'1', author_gender:'',
});

function mockApi() {
  routes = {}; calls = [];
  globalThis.fetch = (async (input:RequestInfo | URL, init?:RequestInit) => {
    const action = String(input).split('/').pop() || '';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({action, body});
    const handler = routes[action];
    if (!handler) throw new Error(`unexpected request: ${action} ${JSON.stringify(body)}`);
    const reply = handler(body);
    return new Response(JSON.stringify(reply.body), {status:reply.status ?? 200, headers:{'content-type':'application/json'}});
  }) as typeof fetch;
}

let domReady = false;
function setupDom() {
  if (domReady) return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost/'});
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.HTMLElement = dom.window.HTMLElement;
  globals.Node = dom.window.Node;
  globals.Event = dom.window.Event;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  domReady = true;
}

type Hook = Awaited<ReturnType<typeof import('../hooks/use-scraper')['useScraper']>>;
type Harness = {React:typeof import('react'); holder:{current:Hook | null}; root:{unmount:()=>void}; container:HTMLElement};

async function renderHook():Promise<Harness> {
  setupDom();
  const React = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {useScraper} = await import('../hooks/use-scraper');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const holder:{current:Hook | null} = {current:null};
  function Harness() { holder.current = useScraper(); return null; }
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Harness)); });
  return {React,holder,root:root as unknown as {unmount:()=>void},container};
}

async function startScrape(harness:Harness, inputs:string[], limit = 100, replies = false) {
  const hook = harness.holder.current;
  if (!hook) throw new Error('hook did not render');
  await harness.React.act(async () => { await hook.start('test-token',inputs,limit,replies); });
  const started = Date.now();
  while (!['Completed','Partially Completed','Failed','Stopped'].includes(harness.holder.current?.status || '')) {
    if (Date.now() - started > 5000) throw new Error(`scrape did not finish (${harness.holder.current?.status} / ${harness.holder.current?.current} / ${harness.holder.current?.error})`);
    await harness.React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  const hookNow = harness.holder.current;
  if (!hookNow) throw new Error('hook disappeared');
  return hookNow;
}

async function close(harness:Harness) {
  await harness.React.act(async () => { harness.root.unmount(); });
  harness.container.remove();
}

test('collects several posts into one queue, de-duplicating records and attaching replies', async () => {
  mockApi();
  routes.post = body => ({body:{id:String(body.post), message:`Post ${String(body.post)}`, created_time:'2024-01-01T00:00:00+0000'}});
  routes.comments = body => {
    const id = String(body.id);
    if (id === '111_1') {
      if (body.cursor === 'n1') return {body:{records:[record('c3'),record('c2')], replyCandidates:[], nextCursor:null}};
      return {body:{records:[record('c1'),record('c2')], replyCandidates:['c1'], nextCursor:'n1'}};
    }
    return {body:{records:[record('c4')], replyCandidates:[], nextCursor:null}};
  };
  routes.replies = () => ({body:{records:[record('r1','c1')], replyCandidates:[], nextCursor:null}});
  const harness = await renderHook();
  const hook = await startScrape(harness,['111_1','222_2'],2,true);
  assert.equal(hook.status,'Completed');
  assert.deepEqual(hook.records.map(item => item.id).sort(), ['c1','c2','c3','c4','r1']);
  assert.deepEqual(hook.targets.map(target => target.id), ['111_1','222_2']);
  assert.equal(hook.origin.c4,'222_2');
  assert.equal(hook.origin.r1,'111_1');
  assert.equal(hook.batches,4);
  assert.equal(calls.filter(call => call.action === 'post').length,2);
  assert.equal(calls.filter(call => call.action === 'replies').length,1);
  await close(harness);
});

test('one unreadable post does not discard the others, and failed batches can be retried', async () => {
  mockApi();
  routes.post = body => ({body:{id:String(body.post), message:`Post ${String(body.post)}`, created_time:''}});
  let fail = true;
  routes.comments = body => {
    if (String(body.id) === '333_3') {
      return fail ? {status:403, body:{error:'Meta could not access this object.', code:'ACCESS', retryable:false}} : {body:{records:[record('c9')], replyCandidates:[], nextCursor:null}};
    }
    return {body:{records:[record('c1')], replyCandidates:[], nextCursor:null}};
  };
  const harness = await renderHook();
  const hook = await startScrape(harness,['111_1','333_3']);
  assert.equal(hook.status,'Partially Completed');
  assert.equal(hook.retryable,true);
  assert.match(hook.error, /Meta could not access this object/);
  assert.deepEqual(hook.records.map(item => item.id), ['c1']);
  fail = false;
  await harness.React.act(async () => { hook.resume(); });
  const started = Date.now();
  while (harness.holder.current?.status !== 'Completed') {
    if (Date.now() - started > 5000) throw new Error('retry did not complete');
    await harness.React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.deepEqual(harness.holder.current?.records.map(item => item.id).sort(), ['c1','c9']);
  await close(harness);
});

test('unresolvable posts are reported and skipped instead of failing the whole run', async () => {
  mockApi();
  routes.post = body => {
    if (String(body.post) === 'nonsense') return {status:400, body:{error:'Unsupported post link or ID.', code:'INPUT', retryable:false}};
    return {body:{id:String(body.post), message:'', created_time:''}};
  };
  routes.comments = () => ({body:{records:[record('c1')], replyCandidates:[], nextCursor:null}});
  const harness = await renderHook();
  const hook = await startScrape(harness,['111_1','nonsense']);
  assert.equal(hook.status,'Completed');
  assert.deepEqual(hook.targets.map(target => target.id), ['111_1']);
  assert.deepEqual(hook.skipped.map(item => item.input), ['nonsense']);
  assert.match(hook.skipped[0].error, /Unsupported post link or ID/);
  await close(harness);
});

test('handles a 1,200-comment multi-page post without losing or duplicating records', async () => {
  mockApi();
  routes.post = body => ({body:{id:String(body.post), message:'Big post', created_time:''}});
  routes.comments = body => {
    const page = body.cursor ? Number(String(body.cursor).slice(1)) : 1;
    const batch = Array.from({length:100}, (_, index) => record(`v${(page - 1) * 100 + index}`));
    return {body:{records:batch, replyCandidates:[], nextCursor:page < 12 ? `p${page + 1}` : null}};
  };
  const harness = await renderHook();
  const hook = await startScrape(harness,['vol_1'],100,false);
  assert.equal(hook.status,'Completed');
  assert.equal(hook.records.length,1200);
  assert.equal(new Set(hook.records.map(item => item.id)).size,1200);
  assert.equal(hook.batches,12);
  assert.equal(hook.origin[hook.records[0].id],'vol_1');
  await close(harness);
});
