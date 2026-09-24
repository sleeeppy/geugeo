import { describe, expect, it } from 'vitest';
import { componentStats, renderSearch } from '../src/bot/ui/results.js';
import type { SearchHit } from '../src/search/query.js';

function hit(id: string, content: string): SearchHit {
  return {
    id,
    channelId: '10',
    authorId: '2',
    authorName: '민수',
    content,
    searchText: content,
    ts: 1_710_224_460_000,
    editedTs: null,
    hasLink: content.includes('http'),
    hasImage: false,
    hasFile: false,
    hasYoutube: content.includes('youtube'),
    attachments: [],
    recipientName: '민수',
  };
}

const filters = { author: 'all' as const, kind: 'all' as const, period: 'all' as const };

describe('search results UI', () => {
  it('stays within Discord component and text limits for five results', () => {
    const hits = [1, 2, 3, 4, 5].map((id) => hit(String(id), `youtube 결과 ${id} https://www.youtube.com/watch?v=abc`));
    const view = renderSearch({
      sessionId: 'abcd1234',
      query: 'youtube',
      hits,
      total: 312,
      page: 0,
      filters,
      scoped: true,
      recipientName: '민수',
      mode: 'keyword',
    });
    const stats = componentStats(view.components);
    expect(stats.count).toBeLessThanOrEqual(40);
    expect(stats.textLength).toBeLessThanOrEqual(4000);
    expect(view.flags).toBeGreaterThan(0);
  });

  it('shrinks long messages instead of exceeding the text limit', () => {
    const hits = [1, 2, 3, 4, 5].map((id) => hit(String(id), `${'가'.repeat(3000)} youtube ${'나'.repeat(3000)}`));
    const view = renderSearch({
      sessionId: 'abcd1234',
      query: 'youtube',
      hits,
      total: 5,
      page: 0,
      filters,
      scoped: true,
      recipientName: '민수',
      mode: 'keyword',
    });
    const stats = componentStats(view.components);
    expect(stats.count).toBeLessThanOrEqual(40);
    expect(stats.textLength).toBeLessThanOrEqual(4000);
  });
});
