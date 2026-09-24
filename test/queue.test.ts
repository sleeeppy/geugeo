import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { JobQueue } from '../src/sync/queue.js';

describe('job queue', () => {
  it('removes queued work for a stopped user and leaves other work', async () => {
    const queue = new JobQueue(createLogger('error'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.enqueue('hold', async () => {
      await gate;
    });
    queue.enqueue('backfill:1', async () => undefined);
    queue.enqueue('incremental:2', async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queue.currentName).toBe('hold');
    expect(queue.cancelMatching((name) => name.endsWith(':1'))).toEqual(['backfill:1']);
    release();
    for (let attempt = 0; attempt < 20 && !queue.idle; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(queue.idle).toBe(true);
  });
});
