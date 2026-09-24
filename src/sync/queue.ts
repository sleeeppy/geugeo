import type { Logger } from '../log.js';

export interface Job {
  name: string;
  run: () => Promise<void>;
}

export class JobQueue {
  private readonly jobs: Job[] = [];
  private readonly active = new Set<string>();

  constructor(private readonly log: Logger) {}

  get size(): number {
    return this.jobs.length + this.active.size;
  }

  get idle(): boolean {
    return this.active.size === 0 && this.jobs.length === 0;
  }

  get waiting(): number {
    return this.jobs.length;
  }

  get currentName(): string | null {
    return this.active.values().next().value ?? null;
  }

  isActive(match: (name: string) => boolean): boolean {
    for (const name of this.active) {
      if (match(name)) return true;
    }
    return false;
  }

  hasWork(match: (name: string) => boolean): boolean {
    return this.isActive(match) || this.jobs.some((job) => match(job.name));
  }

  enqueue(name: string, run: () => Promise<void>): void {
    if (this.active.has(name) || this.jobs.some((job) => job.name === name)) return;
    this.jobs.push({ name, run });
    this.drain();
  }

  cancelMatching(match: (name: string) => boolean): string[] {
    const removed: string[] = [];
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      const job = this.jobs[index];
      if (!job || !match(job.name)) continue;
      removed.push(job.name);
      this.jobs.splice(index, 1);
    }
    return removed;
  }

  private drain(): void {
    while (this.jobs.length > 0) {
      const next = this.jobs[0];
      if (!next) break;
      if (next.name.startsWith('embed:') && this.isActive((name) => !name.startsWith('embed:'))) break;
      this.jobs.shift();
      this.active.add(next.name);
      void next
        .run()
        .catch((error) => this.log.error('작업이 실패했어요.', { job: next.name, error }))
        .finally(() => {
          this.active.delete(next.name);
          this.drain();
        });
    }
  }
}
