// -----------------------------------------------------------------------------
// The only network access (src/zeversolar/client.js): bounded, our own error
// codes, one GET of the status page, never a redirect followed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZeverClient, ZeverError, readBounded } from '../src/zeversolar/client.js';
import { MAX_BODY_BYTES } from '../src/constants.js';
import { ADDRESS, page, text } from './fixtures/zeversolar.js';
import { createFetch, refusedError, streamOf, timeoutError } from './helpers/fakeNet.js';

const client = (handler) => {
  const net = createFetch(handler);
  return { net, client: new ZeverClient({ address: ADDRESS, fetchImpl: net.fetch }) };
};

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ZeverError, String(err));
    return err;
  }
  assert.fail('no error');
};

test('one GET of /home.cgi, no redirect followed, within a timeout', async () => {
  const { net, client: c } = client(() => text(page()));
  const reading = await c.readHome();
  assert.equal(reading.power, 226);
  assert.equal(net.calls.length, 1);
  const [call] = net.calls;
  assert.equal(call.host, ADDRESS);
  assert.equal(call.path, '/home.cgi');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.redirect, 'manual');
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.equal(call.init.headers, undefined, 'no header of ours: no User-Agent, no imitation');
});

test('errors in our own words', async () => {
  const cases = [
    [() => text('x', { status: 404 }), 'not_found'],
    [() => text('x', { status: 302, headers: { location: 'http://evil.example/' } }), 'http'],
    [() => text('x', { status: 401 }), 'http'],
    [() => text('x', { status: 503, headers: { 'retry-after': '120' } }), 'server'],
    [() => text('x', { status: 429 }), 'rate_limited'],
    [() => text('<html>login</html>'), 'unknown_answer'],
    [
      () => {
        throw refusedError();
      },
      'unreachable',
    ],
    [
      () => {
        throw timeoutError();
      },
      'timeout',
    ],
  ];
  for (const [handler, code] of cases) {
    const err = await codeOf(client(handler).client.readHome());
    assert.equal(err.code, code);
    assert.doesNotMatch(err.message, /evil|login|http:/);
  }
  const err = await codeOf(
    client(() => text('x', { status: 503, headers: { 'retry-after': '120' } })).client.readHome(),
  );
  assert.equal(err.retryAfter, 120_000);
  assert.equal(err.status, 503);
});

test('a body larger than the limit is refused, read in one buffer', async () => {
  const many = new Response(streamOf(10_000, 64), { status: 200 });
  const err = await codeOf(readBounded(many, MAX_BODY_BYTES));
  assert.equal(err.code, 'too_large');
  const { client: c } = client(() => new Response(streamOf(100, 1024)));
  assert.equal((await codeOf(c.readHome())).code, 'too_large');
  // Exactly at the limit: read.
  const exact = new Response(streamOf(4, 1024));
  assert.equal((await readBounded(exact, MAX_BODY_BYTES)).length, 4096);
});

test('requests one after the other', async () => {
  let running = 0;
  let most = 0;
  const { client: c } = client(async () => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return text(page());
  });
  await Promise.all([c.readHome(), c.readHome(), c.readHome()]);
  assert.equal(most, 1);
});
