import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PAGE_POSTS_LIMIT, isGraphId, isPageId, mapPagePost, mapPagePosts} from '../lib/posts-core';

test('maps a Page post with its comment summary', () => {
  assert.deepEqual(mapPagePost({
    id: '123_456',
    message: 'Hello world',
    created_time: '2024-05-01T10:00:00+0000',
    comments: {summary: {total_count: 1234}},
  }), {id: '123_456', message: 'Hello world', created_time: '2024-05-01T10:00:00+0000', comment_count: 1234});
  assert.equal(PAGE_POSTS_LIMIT > 0 && PAGE_POSTS_LIMIT <= 100, true);
});

test('a missing comment summary is unknown, not zero', () => {
  assert.deepEqual(mapPagePost({id: '123_456'}), {id: '123_456', message: '', created_time: '', comment_count: null});
  assert.equal(mapPagePost({id: '123_456', comments: {summary: {}}})?.comment_count, null);
  assert.equal(mapPagePost({id: '123_456', comments: {summary: {total_count: '12'}}})?.comment_count, null);
  assert.equal(mapPagePost({id: '123_456', comments: {summary: {total_count: -1}}})?.comment_count, null);
  assert.equal(mapPagePost({id: '123_456', comments: {summary: {total_count: 3.7}}})?.comment_count, 3);
  assert.equal(mapPagePost({id: '123_456', comments: []})?.comment_count, null);
  assert.equal(mapPagePost({id: '123_456', message: 42, created_time: null})?.message, '');
});

test('rejects posts without a usable numeric Graph ID', () => {
  assert.equal(mapPagePost(null), null);
  assert.equal(mapPagePost([]), null);
  assert.equal(mapPagePost('123_456'), null);
  assert.equal(mapPagePost({}), null);
  assert.equal(mapPagePost({id: 123}), null);
  assert.equal(mapPagePost({id: 'pfbid0abc'}), null);
  assert.equal(mapPagePost({id: '123; DROP TABLE'}), null);
  assert.equal(mapPagePost({id: '9'.repeat(129)}), null);
});

test('maps a list, skipping invalid entries and duplicates', () => {
  const posts = mapPagePosts([
    {id: '1_2', message: 'first'},
    {id: 'oops'},
    {id: '1_2', message: 'duplicate'},
    {id: '3_4', message: 'second', comments: {summary: {total_count: 0}}},
    null,
  ]);
  assert.deepEqual(posts.map(post => post.id), ['1_2','3_4']);
  assert.equal(posts[1].comment_count, 0);
});

test('validates Page and Graph IDs', () => {
  assert.equal(isPageId('123456789'), true);
  assert.equal(isPageId('123_456'), false);
  assert.equal(isPageId('page-name'), false);
  assert.equal(isPageId(123), false);
  assert.equal(isGraphId('123'), true);
  assert.equal(isGraphId('123_456'), true);
  assert.equal(isGraphId('123_'), false);
  assert.equal(isGraphId(''), false);
});
