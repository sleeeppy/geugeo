import type { Logger } from '../log.js';
import type { Registry } from '../store/registry.js';
import type { JobQueue } from './queue.js';
import type { Syncer } from './syncer.js';

export function startScheduler(input: {
  syncer: Syncer;
  queue: JobQueue;
  registry: Registry;
  intervalMin: number;
  log: Logger;
}): { stop: () => void } {
  input.syncer.settleIdle();
  const run = () => {
    for (const userId of input.syncer.resumeIncomplete()) {
      input.queue.enqueue(`backfill:${userId}`, () => input.syncer.backfillUser(userId));
    }
    for (const user of input.registry.list()) {
      if (!user.tokenEnc || user.status === 'syncing') continue;
      input.queue.enqueue(`incremental:${user.userId}`, () => input.syncer.incrementalUser(user.userId));
    }
  };
  run();
  const timer = setInterval(() => {
    input.log.info('주기 동기화를 시작해요.');
    run();
  }, Math.max(1, input.intervalMin) * 60_000);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
  };
}

export function enqueueIncremental(queue: JobQueue, syncer: Syncer, registryUserIds: string[]): void {
  for (const userId of registryUserIds) {
    queue.enqueue(`incremental:${userId}`, () => syncer.incrementalUser(userId));
  }
}
