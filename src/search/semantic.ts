import type { Logger } from '../log.js';
import type { UserDirectory } from '../store/userStore.js';
import type { JobQueue } from '../sync/queue.js';

export interface SemanticHit {
  messageId: string;
  score: number;
}

export interface SemanticProgress {
  embedded: number;
  eligible: number;
}

/**
 * Placeholder until the local embedding model is wired in M5.
 * The command stays available and explains that the beta is off when disabled.
 */
export class SemanticIndex {
  constructor(
    private readonly options: {
      enabled: boolean;
      users: UserDirectory;
      queue: JobQueue;
      log: Logger;
      dataDir: string;
    },
  ) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  progress(userId: string): SemanticProgress {
    if (!this.options.users.hasFile(userId)) return { embedded: 0, eligible: 0 };
    return this.options.users.get(userId).countEmbeddings();
  }

  kick(_userId: string): void {}

  async search(_userId: string, _question: string, _channelId?: string): Promise<SemanticHit[]> {
    return [];
  }
}
