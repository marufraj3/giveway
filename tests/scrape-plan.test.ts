import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPostId, isSharePostLink} from '../lib/facebook';
import {MAX_POSTS_PER_SCRAPE, partitionPostInputs, planTargets, splitPostInputs} from '../lib/scrape-plan';

const supported = (value:string) => extractPostId(value) !== null || isSharePostLink(value);

test('splits pasted lists on lines, commas and spaces without duplicates', () => {
  assert.deepEqual(splitPostInputs('123_456\n\n 789_1011 , 123_456'), ['123_456','789_1011']);
  assert.deepEqual(splitPostInputs('https://www.facebook.com/share/p/1QRxGLCoso/'), ['https://www.facebook.com/share/p/1QRxGLCoso/']);
  assert.deepEqual(splitPostInputs('   '), []);
  assert.deepEqual(splitPostInputs('x'.repeat(2049)), []);
});

test('classifies supported post inputs and keeps unsupported ones visible', () => {
  const input = [
    '123_456',
    'https://www.facebook.com/123/posts/456/',
    'https://m.facebook.com/story.php?story_fbid=456&id=123',
    'https://www.facebook.com/share/p/1QRxGLCoso/',
    'not-a-post',
    'https://www.facebook.com/share/v/abc123/',
  ].join('\n');
  const result = partitionPostInputs(input, supported);
  assert.deepEqual(result.valid, [
    '123_456',
    'https://www.facebook.com/123/posts/456/',
    'https://m.facebook.com/story.php?story_fbid=456&id=123',
    'https://www.facebook.com/share/p/1QRxGLCoso/',
  ]);
  assert.deepEqual(result.invalid, ['not-a-post','https://www.facebook.com/share/v/abc123/']);
  assert.equal(result.truncated, false);
});

test('caps pasted inputs and reports truncation', () => {
  const input = Array.from({length: 60}, (_, index) => `10${index}_20${index}`).join('\n');
  const result = partitionPostInputs(input, supported);
  assert.equal(result.valid.length, MAX_POSTS_PER_SCRAPE);
  assert.equal(result.truncated, true);
  assert.deepEqual(partitionPostInputs('1_2\n3_4', supported, 1), {valid:['1_2'], invalid:[], truncated:true});
});

test('combines picked posts with pasted inputs, de-duplicating and capping', () => {
  const plan = planTargets(['111_222','333_444'], ['333_444','https://www.facebook.com/share/p/1QRxGLCoso/']);
  assert.deepEqual(plan, {inputs:['111_222','333_444','https://www.facebook.com/share/p/1QRxGLCoso/'], truncated:false});
  assert.deepEqual(planTargets([], []), {inputs:[], truncated:false});
  const many = Array.from({length: 55}, (_, index) => `${index}`);
  const capped = planTargets(many.slice(0, 30), many.slice(30));
  assert.equal(capped.inputs.length, MAX_POSTS_PER_SCRAPE);
  assert.equal(capped.truncated, true);
});
