import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPostId,mapComment} from '../lib/facebook';
import {FIELDS} from '../lib/types';
import {graph,GraphError,nextCursor} from '../lib/graph-core';

test('extracts supported IDs and rejects ambiguous or unsafe links',()=>{
  assert.equal(extractPostId('123_456'),'123_456');
  assert.equal(extractPostId('https://www.facebook.com/123/posts/456/'),'123_456');
  assert.equal(extractPostId('https://facebook.com/example/posts/456'),'456');
  assert.equal(extractPostId('https://m.facebook.com/story.php?story_fbid=456&id=123'),'123_456');
  assert.equal(extractPostId('https://facebook.com/permalink.php?fbid=456&id=123'),'123_456');
  assert.equal(extractPostId('https://facebook.com.evil.test/123/posts/456'),null);
  assert.equal(extractPostId('http://facebook.com/123/posts/456'),null);
  assert.equal(extractPostId('https://facebook.com/share/p/abc'),null);
});
test('maps exact schema, defaults, Unicode, timestamps and reply linkage',()=>{
  const row=mapComment({id:'123',from:{name:'আবুল',id:'45'},message:'হ্যালো 👋',created_time:'2026-11-12T21:27:31+0600',like_count:3,comment_count:2},'456');
  assert.deepEqual(Object.keys(row),FIELDS); assert.equal(FIELDS.length,20);
  assert.equal(row.username,'');assert.equal(row.text,'হ্যালো 👋');assert.equal(row.created_at,'2026-11-12T15:27:31.000Z');assert.equal(row.reply_to_id,'456');assert.equal(row.author_id,'45');assert.equal(row.reactions_love,0);assert.equal(row.is_pinned,false);
  const empty=mapComment({id:'1',created_time:'bad'});assert.equal(empty.reply_to_id,'');assert.equal(empty.created_at,'');assert.equal(empty.author,'');assert.equal(empty.likes,0);
});
test('pagination returns only cursors and detects missing cursor',()=>{
  assert.equal(nextCursor({paging:{next:'https://example.test/?access_token=secret',cursors:{after:'cursor'}}}),'cursor');
  assert.equal(nextCursor({paging:{cursors:{after:'cursor'}}}),null);
  assert.throws(()=>nextCursor({paging:{next:'https://example.test'}}),/cursor/);
});
test('Graph bearer authorization never places token in URL and sanitizes errors',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async (input,init)=>{assert.ok(!String(input).includes('SECRET'));assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer SECRET');return new Response(JSON.stringify({id:'1'}),{status:200});};
    assert.equal((await graph('me','SECRET',{fields:'id'})).id,'1');
    globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:190,message:'SECRET sensitive'}}),{status:400});
    await assert.rejects(graph('me','SECRET'),(err:GraphError)=>err.code==='TOKEN'&&!err.message.includes('SECRET'));
    globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:4,message:'SECRET'}}),{status:429});
    await assert.rejects(graph('me','SECRET'),(err:GraphError)=>err.code==='RATE_LIMIT'&&err.retryable);
  } finally {globalThis.fetch=original;}
});
