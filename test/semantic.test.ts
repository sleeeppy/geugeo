import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { isEligible, SemanticIndex, type EmbedFn } from '../src/search/semantic.js';
import { JobQueue } from '../src/sync/queue.js';
import { channel, fixtureStore, message } from './helpers.js';

const embed: EmbedFn = async (texts) =>
  texts.map((text) => {
    const vector = new Float32Array(384);
    vector[text.includes('노래') ? 0 : 1] = 1;
    return vector;
  });

describe('semantic search', () => {
  it('ranks a music message above unrelated messages for 노래 추천', async () => {
    const fx = fixtureStore();
    const store = fx.users.get('100000000000000031');
    store.upsertChannel(channel({ id: '10', recipientName: '지연' }));
    store.upsertMessages([
      message({ id: '1', content: '오늘 날씨 진짜 좋다', searchText: '오늘 날씨 진짜 좋다', channelId: '10' }),
      message({ id: '2', content: '저번에 노래 추천해줬던 아이유 다시 듣고 싶어', searchText: '저번에 노래 추천해줬던 아이유 다시 듣고 싶어', channelId: '10' }),
    ]);
    const semantic = new SemanticIndex({
      enabled: true,
      users: fx.users,
      queue: new JobQueue(createLogger('error')),
      log: createLogger('error'),
      dataDir: fx.dir,
      embed,
    });
    semantic.kick('100000000000000031');
    await waitFor(() => semantic.progress('100000000000000031').embedded === 2);
    const hits = await semantic.search('100000000000000031', '노래 추천');
    expect(hits[0]?.messageId).toBe('2');
    fx.close();
  });

  it('stays inactive when disabled', async () => {
    const fx = fixtureStore();
    const semantic = new SemanticIndex({
      enabled: false,
      users: fx.users,
      queue: new JobQueue(createLogger('error')),
      log: createLogger('error'),
      dataDir: fx.dir,
      embed,
    });
    semantic.kick('100000000000000031');
    expect(await semantic.search('100000000000000031', '노래')).toEqual([]);
    fx.close();
  });

  it('skips link-only messages and very short text', () => {
    expect(isEligible({ content: 'https://youtu.be/abc', searchText: 'https://youtu.be/abc' })).toBe(false);
    expect(isEligible({ content: 'https://youtu.be/abc', searchText: 'https://youtu.be/abc\n아이유 - 밤편지' })).toBe(true);
    expect(isEligible({ content: '밥', searchText: '밥' })).toBe(false);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('임베딩이 끝나지 않았어요.');
}
