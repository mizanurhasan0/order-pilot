import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedQueue } from '../src/utils/keyedQueue.js';

// A promise that a test resolves or rejects by hand.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets every pending promise callback run (no timers involved).
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('same key: tasks run in call order even when earlier tasks are slower', async () => {
  const queue = createKeyedQueue();
  const log = [];
  const first = deferred();
  const second = deferred();

  const p1 = queue.run('a', async () => {
    log.push('start 1');
    await first.promise;
    log.push('end 1');
    return 1;
  });
  const p2 = queue.run('a', async () => {
    log.push('start 2');
    await second.promise;
    log.push('end 2');
    return 2;
  });
  const p3 = queue.run('a', () => {
    log.push('run 3');
    return 3;
  });

  await flush();
  assert.deepEqual(log, ['start 1']);

  // The second task is ready first, but it still has to wait for the first.
  second.resolve();
  await flush();
  assert.deepEqual(log, ['start 1']);

  first.resolve();
  assert.deepEqual(await Promise.all([p1, p2, p3]), [1, 2, 3]);
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2', 'run 3']);
});

test('different keys run at the same time', async () => {
  const queue = createKeyedQueue();
  const log = [];
  const slow = deferred();
  const fast = deferred();

  const pSlow = queue.run('x', async () => {
    log.push('start x');
    await slow.promise;
    log.push('end x');
  });
  const pFast = queue.run('y', async () => {
    log.push('start y');
    await fast.promise;
    log.push('end y');
  });

  await flush();
  assert.deepEqual(log, ['start x', 'start y']);

  // y is not held back by the unfinished task of x.
  fast.resolve();
  await pFast;
  assert.deepEqual(log, ['start x', 'start y', 'end y']);

  slow.resolve();
  await pSlow;
  assert.deepEqual(log, ['start x', 'start y', 'end y', 'end x']);
});

test('a failing task rejects only its own promise and does not block the next one', async () => {
  const queue = createKeyedQueue();
  const failure = new Error('boom');
  const gate = deferred();
  const log = [];

  const p1 = queue.run('a', async () => {
    log.push('start 1');
    await gate.promise;
    throw failure;
  });
  const p2 = queue.run('a', () => {
    log.push('start 2');
    return 'ok';
  });
  const p3 = queue.run('b', () => 'other key');

  gate.resolve();
  await assert.rejects(p1, (error) => error === failure);
  assert.equal(await p2, 'ok');
  assert.equal(await p3, 'other key');
  assert.deepEqual(log, ['start 1', 'start 2']);
});

test('a task that rejects with a non-Error value passes it on unchanged', async () => {
  const queue = createKeyedQueue();
  await assert.rejects(
    queue.run('a', () => Promise.reject('plain string')),
    (reason) => reason === 'plain string',
  );
  assert.equal(await queue.run('a', () => 'next'), 'next');
});

test('return values propagate for sync and async tasks', async () => {
  const queue = createKeyedQueue();
  const object = { id: 1 };

  assert.equal(await queue.run('a', () => 42), 42);
  assert.equal(await queue.run('a', async () => 'async'), 'async');
  assert.equal(await queue.run('a', () => object), object);
  assert.equal(await queue.run('a', () => undefined), undefined);
  assert.equal(await queue.run('a', () => Promise.resolve(null)), null);
});

test('a synchronous throw becomes a rejection and later tasks still run', async () => {
  const queue = createKeyedQueue();
  const failure = new Error('sync failure');

  const p1 = queue.run('a', () => {
    throw failure;
  });
  const p2 = queue.run('a', () => 'after');

  await assert.rejects(p1, (error) => error === failure);
  assert.equal(await p2, 'after');
});

test('run never throws synchronously, and a task never starts inside run()', async () => {
  const queue = createKeyedQueue();
  let started = false;

  const promise = queue.run('a', () => {
    started = true;
  });
  assert.equal(started, false);
  await promise;
  assert.equal(started, true);
});

test('a task that is not a function is rejected with a TypeError', async () => {
  const queue = createKeyedQueue();
  await assert.rejects(queue.run('a', 'not a function'), TypeError);
  await assert.rejects(queue.run('a'), TypeError);
  assert.equal(queue.size(), 0);
  assert.equal(await queue.run('a', () => 'still works'), 'still works');
});

test('size counts keys that are busy and returns to 0 once drained', async () => {
  const queue = createKeyedQueue();
  assert.equal(queue.size(), 0);

  const gateA = deferred();
  const gateB = deferred();
  const pA1 = queue.run('a', () => gateA.promise);
  const pA2 = queue.run('a', () => 'a2');
  const pB = queue.run('b', () => gateB.promise);
  assert.equal(queue.size(), 2);

  gateB.resolve();
  await pB;
  assert.equal(queue.size(), 1);

  gateA.resolve();
  await Promise.all([pA1, pA2]);
  assert.equal(queue.size(), 0);
});

test('size returns to 0 after failures too, and a drained key can be reused', async () => {
  const queue = createKeyedQueue();

  await assert.rejects(
    queue.run('a', () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(queue.size(), 0);

  assert.equal(await queue.run('a', () => 'again'), 'again');
  assert.equal(queue.size(), 0);
});

test('a task queued from inside a task of the same key runs after it', async () => {
  const queue = createKeyedQueue();
  const log = [];
  let inner;

  await queue.run('a', () => {
    log.push('outer start');
    inner = queue.run('a', () => {
      log.push('inner');
    });
    log.push('outer end');
  });
  await inner;

  assert.deepEqual(log, ['outer start', 'outer end', 'inner']);
  assert.equal(queue.size(), 0);
});

test('1000 queued tasks of one key keep their order', async () => {
  const queue = createKeyedQueue();
  const order = [];
  const results = [];

  for (let i = 0; i < 1000; i += 1) {
    results.push(
      queue.run('busy', async () => {
        // Different amounts of waiting, so a slow task can never be overtaken.
        for (let step = 0; step < i % 7; step += 1) await Promise.resolve();
        if (i % 100 === 0) await flush();
        order.push(i);
        return i;
      }),
    );
  }

  const values = await Promise.all(results);
  const expected = Array.from({ length: 1000 }, (_, i) => i);
  assert.deepEqual(order, expected);
  assert.deepEqual(values, expected);
  assert.equal(queue.size(), 0);
});
