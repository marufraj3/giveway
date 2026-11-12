import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccessToken} from '../lib/token-input';

test('trims pasted whitespace and invisible characters at the edges only', () => {
  assert.deepEqual(normalizeAccessToken('  EAAB123\n'), {token:'EAAB123', error:null});
  assert.deepEqual(normalizeAccessToken('\u00a0\u200bEAAB123\ufeff\t'), {token:'EAAB123', error:null});
  assert.deepEqual(normalizeAccessToken('EAAB123|appsecret'), {token:'EAAB123|appsecret', error:null});
});

test('rejects tokens with internal whitespace instead of silently changing them', () => {
  assert.match(normalizeAccessToken('EAAB 123')?.error || '', /spaces or line breaks/);
  assert.match(normalizeAccessToken('EAAB\n123')?.error || '', /spaces or line breaks/);
  assert.match(normalizeAccessToken('EAAB\u200b123')?.error || '', /spaces or line breaks/);
});

test('rejects missing, non-string and oversized tokens', () => {
  assert.match(normalizeAccessToken(undefined)?.error || '', /valid access token/);
  assert.match(normalizeAccessToken(null)?.error || '', /valid access token/);
  assert.match(normalizeAccessToken(123)?.error || '', /valid access token/);
  assert.match(normalizeAccessToken('   ')?.error || '', /valid access token/);
  assert.match(normalizeAccessToken('a'.repeat(8193))?.error || '', /too long/);
  assert.equal(normalizeAccessToken('a'.repeat(8192)).error, null);
});
