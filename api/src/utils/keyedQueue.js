// Runs async tasks one at a time per key, while different keys run in parallel.
//
// Used to keep one customer's messages in order: if a customer sends two
// messages quickly, the second must not be processed (or answered) before the
// first one has finished, even though Meta delivers both webhook events at once.
//
// Limits: the queue lives in memory in one process. It does not order work
// across several server instances.

export function createKeyedQueue() {
  // key -> a promise that resolves when the last queued task for that key has
  // finished. It never rejects, so a failed task cannot block the next one.
  const tails = new Map();

  return {
    // Queues `task` (sync or async) behind every earlier task of the same key and
    // returns a promise for its result. A task never starts inside this call, and
    // a failing task rejects only its own promise.
    run(key, task) {
      if (typeof task !== 'function') {
        return Promise.reject(new TypeError('task must be a function'));
      }

      const previous = tails.get(key) ?? Promise.resolve();
      let finish;
      const turn = new Promise((resolve) => {
        finish = resolve;
      });
      tails.set(key, turn);

      return previous.then(async () => {
        try {
          return await task();
        } finally {
          // Clean up before the caller sees the result, and only when nothing
          // else was queued behind this task.
          if (tails.get(key) === turn) tails.delete(key);
          finish();
        }
      });
    },

    // Number of keys that still have queued or running tasks.
    size() {
      return tails.size;
    },
  };
}
