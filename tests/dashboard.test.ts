import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

type Reply = {status?:number; body:unknown};
type Call = {action:string; body:Record<string, unknown>};
let routes:Record<string, (body:Record<string, unknown>) => Reply> = {};
let calls:Call[] = [];

function mockApi() {
  routes = {}; calls = [];
  globalThis.fetch = (async (input:RequestInfo | URL, init?:RequestInit) => {
    const action = String(input).split('/').pop() || '';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({action, body});
    const handler = routes[action];
    if (!handler) throw new Error(`unexpected request: ${action}`);
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

type Rendered = {React:typeof import('react'); root:{unmount:()=>void}; container:HTMLElement; text:()=>string};

async function renderDashboard():Promise<Rendered> {
  setupDom();
  const React = await import('react');
  const {createRoot} = await import('react-dom/client');
  const Dashboard = (await import('../components/dashboard')).default;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Dashboard)); });
  return {React,root:root as unknown as {unmount:()=>void},container,text:() => container.textContent || ''};
}

async function waitFor(rendered:Rendered, check:() => boolean, label:string) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 4000) throw new Error(`timed out waiting for ${label}: ${rendered.text().slice(0,200)}`);
    await rendered.React.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
}

async function close(rendered:Rendered) {
  await rendered.React.act(async () => { rendered.root.unmount(); });
  rendered.container.remove();
}

test('the first screen is the access token page, not the dashboard', async () => {
  mockApi();
  setupDom();
  window.sessionStorage.clear();
  const rendered = await renderDashboard();
  await waitFor(rendered,() => /Open your workspace/.test(rendered.text()),'token page');
  assert.match(rendered.text(),/Access token/);
  assert.doesNotMatch(rendered.text(),/At a glance/);
  assert.equal(calls.filter(call => call.action === 'pages').length,0);
  await close(rendered);
});

test('a token kept for the tab opens the dashboard and lists Pages', async () => {
  mockApi();
  const {writeSessionToken,readSessionToken} = await import('../lib/session-token');
  writeSessionToken('stored-token');
  routes.validate = () => ({body:{id:'1000', name:'Stored User', type:'Unknown'}});
  routes.pages = () => ({body:{pages:[{id:'501',name:'Page One'},{id:'502',name:'Page Two'}], nextCursor:null}});
  const rendered = await renderDashboard();
  await waitFor(rendered,() => /At a glance/.test(rendered.text()) && /Stored User/.test(rendered.text()),'dashboard');
  assert.match(rendered.text(),/Connected/);
  assert.equal(readSessionToken(),'stored-token');
  assert.equal(calls.filter(call => call.action === 'pages').length,1);
  assert.equal(calls.find(call => call.action === 'validate')?.body.token,'stored-token');
  await close(rendered);
});

test('an expired kept token returns to the token page with a clear reason', async () => {
  mockApi();
  const {writeSessionToken,readSessionToken} = await import('../lib/session-token');
  writeSessionToken('expired-token');
  routes.validate = () => ({status:401, body:{error:'The access token is invalid or expired. Check it and reconnect.', code:'TOKEN', retryable:false}});
  const rendered = await renderDashboard();
  await waitFor(rendered,() => /invalid or expired/.test(rendered.text()),'token page notice');
  assert.match(rendered.text(),/Open your workspace/);
  assert.equal(readSessionToken(),'');
  assert.equal(calls.filter(call => call.action === 'pages').length,0);
  await close(rendered);
});

test('Pages feed their posts, and several selected posts scrape together from one click', async () => {
  mockApi();
  const {writeSessionToken} = await import('../lib/session-token');
  writeSessionToken('stored-token');
  routes.validate = () => ({body:{id:'1000', name:'Stored User', type:'Unknown'}});
  routes.pages = () => ({body:{pages:[{id:'501',name:'Page One'}], nextCursor:null}});
  routes.pageposts = () => ({body:{posts:[
    {id:'501_900', message:'First post', created_time:'2024-01-02T03:04:05+0000', comment_count:1500},
    {id:'501_901', message:'Second post', created_time:'2024-02-03T04:05:06+0000', comment_count:null},
  ], nextCursor:null}});
  routes.post = body => ({body:{id:String(body.post), message:`Resolved ${String(body.post)}`, created_time:''}});
  routes.comments = body => ({body:{records:[
    {author:'Author', username:'', text:`comment on ${String(body.id)}`, likes:0, replies:0, created_at:'2024-01-01T00:00:00.000Z', language:'', is_pinned:false, id:`c-${String(body.id)}`, reply_to_id:'', avatar_url:'', reaction_count:0, reactions_love:0, reactions_haha:0, reactions_wow:0, reactions_sad:0, reactions_anger:0, reactions_care:0, author_id:'1', author_gender:''},
  ], replyCandidates:[], nextCursor:null}});

  const rendered = await renderDashboard();
  await waitFor(rendered,() => /At a glance/.test(rendered.text()),'dashboard');

  const click = async (element:Element | undefined, label:string) => {
    if (!element) throw new Error(`missing ${label}`);
    await rendered.React.act(async () => { (element as HTMLElement).click(); });
  };
  const row = (text:string) => Array.from(rendered.container.querySelectorAll('label.check-row')).find(label => (label.textContent || '').includes(text));

  await click(Array.from(rendered.container.querySelectorAll('button')).find(button => (button.textContent || '').includes('New Scraper')),'New Scraper');
  await waitFor(rendered,() => /Choose Pages and posts/.test(rendered.text()),'scraper form');

  await click(row('Page One')?.querySelector('input[type="checkbox"]') ?? undefined,'Page One checkbox');
  await waitFor(rendered,() => /First post/.test(rendered.text()) && calls.some(call => call.action === 'pageposts'),'page posts');
  assert.equal(calls.filter(call => call.action === 'pageposts').length,1);

  await click(row('First post')?.querySelector('input[type="checkbox"]') ?? undefined,'First post checkbox');
  await click(row('Second post')?.querySelector('input[type="checkbox"]') ?? undefined,'Second post checkbox');
  await waitFor(rendered,() => /2 selected/.test(rendered.text()),'two selected posts');

  await click(Array.from(rendered.container.querySelectorAll('button')).find(button => (button.textContent || '').includes('Start scraping')),'Start scraping');
  await waitFor(rendered,() => /2 batches · 2 records/.test(rendered.text()) && /Completed/.test(rendered.text()),'both posts scraped');

  assert.equal(calls.filter(call => call.action === 'post').length,2);
  assert.deepEqual(calls.filter(call => call.action === 'comments').map(call => call.body.id).sort(), ['501_900','501_901']);
  assert.match(rendered.text(),/2 batches/);
  await close(rendered);
});
