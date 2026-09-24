import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMessage } from '../src/discord/normalize.js';
import { searchMessages, type SearchFilters } from '../src/search/query.js';
import { channel, fixtureStore, message } from './helpers.js';

const opened: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const item of opened.splice(0)) item.close();
});

const filters: SearchFilters = { author: 'all', kind: 'all', period: 'all' };
const NOW = Date.parse('2024-06-01T00:00:00.000Z');

function seed() {
  const fx = fixtureStore();
  opened.push(fx);
  const store = fx.users.get('100000000000000009');
  store.upsertChannel(channel({ id: '10', recipientName: '민수' }));
  const youtube = normalizeMessage(
    {
      id: '1',
      type: 0,
      content: '이거 봐바 https://www.youtube.com/watch?v=abc',
      timestamp: '2024-03-12T06:21:00.000Z',
      author: { id: '200', username: 'minsu', global_name: '민수' },
      embeds: [{ title: '아이유 - 밤편지 (Live)', url: 'https://www.youtube.com/watch?v=abc', provider: { name: 'YouTube' } }],
    },
    '10',
  );
  const meeting = normalizeMessage(
    {
      id: '2',
      content: '내일 회의록이야',
      timestamp: '2024-05-01T00:00:00.000Z',
      author: { id: '100000000000000009', username: 'me', global_name: '나' },
    },
    '10',
  );
  const file = normalizeMessage(
    {
      id: '3',
      content: '파일',
      timestamp: '2024-01-01T00:00:00.000Z',
      author: { id: '200', username: 'minsu', global_name: '민수' },
      attachments: [{ filename: '예산안.pdf', size: 10, content_type: 'application/pdf' }],
    },
    '10',
  );
  const image = normalizeMessage(
    {
      id: '4',
      content: '사진',
      timestamp: '2024-05-20T00:00:00.000Z',
      author: { id: '200', username: 'minsu', global_name: '민수' },
      attachments: [{ filename: 'shot.png', size: 10, content_type: 'image/png' }],
    },
    '10',
  );
  store.upsertMessages([youtube, meeting, file, image].filter((item) => item != null));
  store.upsertMessages([
    message({
      id: '5',
      content: '100% 확실_한 "인용"',
      searchText: '100% 확실_한 "인용"',
      ts: Date.parse('2024-05-28T00:00:00.000Z'),
      authorId: '100000000000000009',
      authorName: '나',
    }),
  ]);
  return store;
}

describe('search', () => {
  it('finds youtube inside a URL', () => {
    const store = seed();
    const result = searchMessages(store.db, { raw: 'youtube', requesterId: '100000000000000009', filters, page: 0 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.hits.some((hit) => hit.id === '1')).toBe(true);
  });

  it('finds a two-character Korean word inside a longer word', () => {
    const store = seed();
    const result = searchMessages(store.db, { raw: '회의', requesterId: '100000000000000009', filters, page: 0 });
    expect(result.hits.map((hit) => hit.id)).toContain('2');
  });

  it('finds a one-character query', () => {
    const store = seed();
    const result = searchMessages(store.db, { raw: '사', requesterId: '100000000000000009', filters, page: 0 });
    expect(result.hits.map((hit) => hit.id)).toContain('4');
  });

  it('ignores ASCII case', () => {
    const store = seed();
    const result = searchMessages(store.db, { raw: 'YouTube', requesterId: '100000000000000009', filters, page: 0 });
    expect(result.hits.some((hit) => hit.id === '1')).toBe(true);
  });

  it('requires every word', () => {
    const store = seed();
    const result = searchMessages(store.db, { raw: 'youtube 밤편지', requesterId: '100000000000000009', filters, page: 0 });
    expect(result.hits.map((hit) => hit.id)).toEqual(['1']);
    const missing = searchMessages(store.db, { raw: 'youtube 회의', requesterId: '100000000000000009', filters, page: 0 });
    expect(missing.total).toBe(0);
  });

  it('searches special characters literally', () => {
    const store = seed();
    expect(searchMessages(store.db, { raw: '100%', requesterId: '9', filters, page: 0 }).hits[0]?.id).toBe('5');
    expect(searchMessages(store.db, { raw: '확실_', requesterId: '9', filters, page: 0 }).hits[0]?.id).toBe('5');
    expect(searchMessages(store.db, { raw: '"인용"', requesterId: '9', filters, page: 0 }).total).toBeGreaterThan(0);
  });

  it('filters by author, kind, and period', () => {
    const store = seed();
    const me = '100000000000000009';
    const byMe = searchMessages(store.db, { raw: '회', requesterId: me, filters: { ...filters, author: 'me' }, page: 0 });
    expect(byMe.hits.every((hit) => hit.authorId === me)).toBe(true);
    const files = searchMessages(store.db, {
      raw: 'pdf',
      requesterId: me,
      filters: { ...filters, kind: 'file' },
      page: 0,
    });
    expect(files.hits.map((hit) => hit.id)).toEqual(['3']);
    const recent = searchMessages(store.db, {
      raw: '파일',
      requesterId: me,
      filters: { ...filters, period: '30d' },
      page: 0,
      now: NOW,
    });
    expect(recent.total).toBe(0);
  });

  it('returns a page and a total', () => {
    const store = seed();
    for (let index = 0; index < 12; index += 1) {
      store.upsertMessages([
        message({
          id: String(100 + index),
          content: `youtube extra ${index}`,
          searchText: `youtube extra ${index}`,
          ts: NOW - index * 1000,
        }),
      ]);
    }
    const result = searchMessages(store.db, { raw: 'youtube', requesterId: '100000000000000009', filters, page: 1 });
    expect(result.pageSize).toBe(5);
    expect(result.hits).toHaveLength(5);
    expect(result.total).toBeGreaterThan(5);
  });

  it('finds an embed title and an attachment name', () => {
    const store = seed();
    expect(searchMessages(store.db, { raw: '밤편지', requesterId: '1', filters, page: 0 }).hits[0]?.id).toBe('1');
    expect(searchMessages(store.db, { raw: '예산안', requesterId: '1', filters, page: 0 }).hits[0]?.id).toBe('3');
  });
});
