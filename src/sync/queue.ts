import type { Logger } from '../log.js';

export interface Job {
  name: string;
  run: () => Promise<void>;
}

export class JobQueue {
  private running = false;
  private readonly jobs: Job[] = [];

  constructor(private readonly log: Logger) {}

  get size(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  get idle(): boolean {
    return !this.running && this.jobs.length === 0;
  }

  get waiting(): number {
    return this.jobs.length;
  }

  enqueue(name: string, run: () => Promise<void>): void {
    if (this.jobs.some((job) => job.name === name) || (this.running && this.current === name)) return;
    this.jobs.push({ name, run });
    void this.pump();
  }

  private current: string | null = null;

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (!job) break;
      this.current = job.name;
      try {
        await job.run();
      } catch (error) {
        this.log.error('작업이 실패했어요.', { job: job.name, error });
      }
    }
    this.current = null;
    this.running = false;
  }
}
