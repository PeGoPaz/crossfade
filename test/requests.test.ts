import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { HttpError, Requests, type RequestsOptions, retryAfter } from '../src/requests.ts';

/**
 * A clock that never really waits: sleeping moves it on. The fetch answers
 * from a script, one answer per call - a status, a status with headers, or
 * an Error to throw - and records when each call came.
 */
function setup(answers: (number | [number, Record<string, string>] | Error)[], options: Partial<RequestsOptions> = {}) {
  let now = 0;
  const waits: number[] = [];
  const calls: { url: string; at: number; init: RequestInit }[] = [];
  const told: string[] = [];
  const requests = new Requests({
    spacingMs: 500,
    random: () => 1,
    clock: {
      now: () => now,
      sleep: async ms => {
        waits.push(ms);
        now += ms;
      },
    },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), at: now, init });
      const answer = answers.shift() ?? 200;
      if (answer instanceof Error) throw answer;
      const [status, headers] = Array.isArray(answer) ? answer : [answer, {}];
      // No statusText: over HTTP/2 there is none.
      return new Response(status === 200 ? '{}' : 'nope', { status, headers });
    },
    onWait: (ms, reason) => told.push(`${ms} ${reason}`),
    ...options,
  });
  return { requests, waits, calls, told };
}

const url = 'https://api.example.com/tracks';

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected an HttpError, got ${error}`);
    return error;
  }
  assert.fail('the request did not fail');
}

describe('Requests', () => {
  test('returns a successful answer', async () => {
    const { requests } = setup([200]);
    const response = await requests.fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  });

  test('keeps the pause between the starts of two requests', async () => {
    const { requests, calls } = setup([200, 200, 200]);
    await requests.fetch(url);
    await requests.fetch(url);
    await requests.fetch(url);
    assert.deepEqual(calls.map(call => call.at), [0, 500, 1000]);
  });

  test('requests made at once still go one at a time, in order', async () => {
    const { requests, calls } = setup([200, 200, 200]);
    await Promise.all(['a', 'b', 'c'].map(path => requests.fetch(`${url}/${path}`)));
    assert.deepEqual(
      calls.map(call => [call.url.slice(-1), call.at]),
      [['a', 0], ['b', 500], ['c', 1000]],
    );
  });

  test('tries again when the service is busy, saying why it waits', async () => {
    const { requests, calls, told } = setup([503, 200]);
    const response = await requests.fetch(url);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(told, ['1000 503 Service Unavailable']);
  });

  test('waits as long as Retry-After asks', async () => {
    const { requests, calls } = setup([[429, { 'Retry-After': '7' }], 200]);
    await requests.fetch(url);
    assert.deepEqual(calls.map(call => call.at), [0, 7000]);
  });

  test('waits twice as long each time, then gives up', async () => {
    const { requests, waits, calls } = setup([500, 500, 500, 500, 500]);
    const error = await failure(requests.fetch(url));
    assert.equal(calls.length, 5);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000]);
    assert.equal(error.status, 500);
    assert.equal(error.message, 'GET https://api.example.com/tracks: 500 Internal Server Error');
  });

  test('a random share of each wait keeps retries out of step', async () => {
    const { requests, waits } = setup([500, 500, 200], { random: () => 0 });
    await requests.fetch(url);
    assert.deepEqual(waits, [500, 1000]);
  });

  test('stops at once when asked to wait too long', async () => {
    const { requests, calls } = setup([[429, { 'Retry-After': '3600' }]]);
    const error = await failure(requests.fetch(url));
    assert.equal(calls.length, 1);
    assert.equal(error.message, 'GET https://api.example.com/tracks: 429 Too Many Requests, and asked to wait 60 min; try again later');
  });

  test('an answer that means no is not asked again', async () => {
    for (const status of [400, 401, 403, 404]) {
      const { requests, calls } = setup([status]);
      const error = await failure(requests.fetch(url));
      assert.equal(error.status, status);
      assert.equal(calls.length, 1);
    }
  });

  test('tries again after a network error', async () => {
    const { requests, calls, told } = setup([new TypeError('fetch failed'), 200]);
    await requests.fetch(url);
    assert.equal(calls.length, 2);
    assert.deepEqual(told, ['1000 network error']);
  });

  test('gives up on a request that gets no answer', async () => {
    // A real request keeps Node running through its open connection; this
    // one has none, and the timeout's own timer does not.
    const alive = setInterval(() => {}, 1000);
    after(() => clearInterval(alive));
    const { requests } = setup([], {
      timeoutMs: 20,
      retries: 0,
      fetch: (_, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    });
    const error = await failure(requests.fetch(url));
    assert.equal(error.message, 'GET https://api.example.com/tracks: no answer within 20 ms');
    assert.equal(error.status, undefined);
  });

  test('a request its caller cancels is not tried again', async () => {
    const { requests, calls } = setup([new DOMException('aborted', 'AbortError')]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(requests.fetch(url, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls.length, 1);
  });

  test('the body of a failed answer is let go, so its connection can be reused', async () => {
    const cancelled: number[] = [];
    let status = 503;
    const { requests } = setup([], {
      retries: 1,
      fetch: async () => {
        const answer = status;
        status = 404;
        const body = new ReadableStream({ cancel: () => void cancelled.push(answer) });
        return new Response(body, { status: answer });
      },
    });
    await failure(requests.fetch(url));
    assert.deepEqual(cancelled, [503, 404]);
  });

  test('error messages carry no query strings or headers', async () => {
    const { requests } = setup([401]);
    const error = await failure(
      requests.fetch(`${url}?access_token=SECRET-TOKEN`, { method: 'POST', headers: { Authorization: 'OAuth SECRET-TOKEN' } }),
    );
    assert.equal(error.message, 'POST https://api.example.com/tracks: 401 Unauthorized');
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /SECRET/);
  });
});

describe('retryAfter', () => {
  test('seconds or a date', () => {
    assert.equal(retryAfter('120', 0), 120_000);
    assert.equal(retryAfter('Tue, 03 Nov 2026 10:00:30 GMT', Date.parse('2026-11-03T10:00:00Z')), 30_000);
    assert.equal(retryAfter('Tue, 03 Nov 2026 09:00:00 GMT', Date.parse('2026-11-03T10:00:00Z')), 0);
    assert.equal(retryAfter('soon', 0), undefined);
    assert.equal(retryAfter(null, 0), undefined);
  });
});
