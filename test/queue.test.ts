import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { JobQueue } from '../src/sync/queue.js';

describe('job queue', () => {
  it('runs collects together and holds embedding until they finish', async () => {
    const queue = new JobQueue(createLogger('error'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    queue.enqueue('collect:1:a', async () => {
      started.push('a');
      await gate;
    });
    queue.enqueue('collect:1:b', async () => {
      started.push('b');
      await gate;
    });
    queue.enqueue('embed:1', async () => {
      started.push('embed');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started.slice().sort()).toEqual(['a', 'b']);
    expect(queue.isActive((name) => name === 'collect:1:a')).toBe(true);
    expect(queue.isActive((name) => name === 'collect:1:b')).toBe(true);
    expect(queue.cancelMatching((name) => name.startsWith('embed:'))).toEqual(['embed:1']);
    release();
    for (let attempt = 0; attempt < 20 && !queue.idle; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(queue.idle).toBe(true);
    expect(started).not.toContain('embed');
  });
});
