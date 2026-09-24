import { join } from 'node:path';
import type { Logger } from '../log.js';
import type { StoredMessage, UserDirectory } from '../store/userStore.js';
import type { JobQueue } from '../sync/queue.js';

export interface SemanticHit {
  messageId: string;
  score: number;
}

export interface SemanticProgress {
  embedded: number;
  eligible: number;
}

export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

const DIMENSION = 384;
const BYTE_LENGTH = DIMENSION * 4;

interface VectorRow {
  id: string;
  channelId: string;
  vec: Float32Array;
}

export class SemanticIndex {
  private loading: Promise<EmbedFn> | null = null;
  private readonly cache = new Map<string, VectorRow[]>();

  constructor(
    private readonly options: {
      enabled: boolean;
      users: UserDirectory;
      queue: JobQueue;
      log: Logger;
      dataDir: string;
      embed?: EmbedFn;
    },
  ) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  progress(userId: string): SemanticProgress {
    if (!this.options.users.hasFile(userId)) return { embedded: 0, eligible: 0 };
    return this.options.users.get(userId).countEmbeddings();
  }

  kick(userId: string): void {
    if (!this.enabled) return;
    this.options.queue.enqueue(`embed:${userId}`, () => this.embedUser(userId));
  }

  async search(userId: string, question: string, channelId?: string): Promise<SemanticHit[]> {
    if (!this.enabled || !this.options.users.hasFile(userId)) return [];
    const embed = await this.embedder();
    const query = (await embed([`query: ${question}`]))[0];
    if (!query) return [];
    const rows = this.vectors(userId).filter((row) => (channelId ? row.channelId === channelId : true));
    return rows
      .map((row) => ({ messageId: row.id, score: dot(query, row.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }

  private async embedUser(userId: string): Promise<void> {
    if (!this.options.users.hasFile(userId)) return;
    if (this.options.queue.hasWork((name) => !name.startsWith('embed:'))) {
      this.kick(userId);
      return;
    }
    const store = this.options.users.get(userId);
    const batch = store.listMessagesForEmbedding(32);
    if (batch.length === 0) {
      this.cache.delete(userId);
      return;
    }
    const embed = await this.embedder();
    const pending = batch.filter(isEligible);
    const skipped = batch.filter((message) => !isEligible(message));
    if (skipped.length > 0) {
      store.putEmbeddings(skipped.map((message) => ({ messageId: message.id, vec: Buffer.alloc(0) })));
    }
    if (pending.length > 0) {
      const vectors = await embed(pending.map((message) => `passage: ${message.searchText.slice(0, 2000)}`));
      store.putEmbeddings(
        pending.map((message, index) => ({
          messageId: message.id,
          vec: Buffer.from(vectors[index]?.buffer ?? new ArrayBuffer(0)),
        })),
      );
    }
    this.cache.delete(userId);
    if (store.listMessagesForEmbedding(1).length > 0) this.kick(userId);
  }

  private vectors(userId: string): VectorRow[] {
    const cached = this.cache.get(userId);
    if (cached) {
      this.cache.delete(userId);
      this.cache.set(userId, cached);
      return cached;
    }
    const rows = this.options.users
      .get(userId)
      .listEmbeddings()
      .flatMap((row) => {
        if (row.vec.byteLength !== BYTE_LENGTH) return [];
        const message = this.options.users.get(userId).getMessage(row.messageId);
        if (!message) return [];
        return [{ id: row.messageId, channelId: message.channelId, vec: new Float32Array(row.vec.buffer, row.vec.byteOffset, DIMENSION) }];
      });
    this.cache.set(userId, rows);
    while (this.cache.size > 2) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return rows;
  }

  private embedder(): Promise<EmbedFn> {
    if (this.options.embed) return Promise.resolve(this.options.embed);
    if (!this.loading) this.loading = loadLocalEmbedder(this.options.dataDir, this.options.log);
    return this.loading;
  }
}

export function isEligible(message: Pick<StoredMessage, 'content' | 'searchText'>): boolean {
  const text = message.searchText.trim();
  if ([...text].length < 4) return false;
  const content = message.content.trim();
  if (/^https?:\/\/\S+$/.test(content) && text === content) return false;
  return true;
}

async function loadLocalEmbedder(dataDir: string, log: Logger): Promise<EmbedFn> {
  const { pipeline } = await import('@huggingface/transformers');
  log.info('AI 검색 모델을 준비해요.');
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    dtype: 'q8',
    cache_dir: join(dataDir, '.cache'),
  });
  return async (texts: string[]) => {
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const data = output.data as Float32Array;
    const width = output.dims.at(-1) ?? DIMENSION;
    const vectors: Float32Array[] = [];
    for (let index = 0; index < texts.length; index += 1) {
      vectors.push(Float32Array.from(data.subarray(index * width, (index + 1) * width)));
    }
    return vectors;
  };
}

function dot(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += (left[index] ?? 0) * (right[index] ?? 0);
  return score;
}
