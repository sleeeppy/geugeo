import { describe, expect, it } from 'vitest';
import { componentStats, renderSearch } from '../src/bot/ui/results.js';
import { formatPersonProgress, formatProgress, renderPersonList } from '../src/bot/ui/theme.js';
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
  it('shows collection progress as a percentage', () => {
    expect(formatProgress(13, 100, 71062)).toBe('13% · 14/100번째 대화 · 메시지 71,062개');
    expect(formatProgress(0, 100, 1200)).toBe('0% · 1/100번째 대화 · 메시지 1,200개');
  });

  it('lists each person with their own count', () => {
    expect(formatPersonProgress('스쿠루', 1600, 'active')).toBe('스쿠루 · 수집 중 · 1,600개');
    expect(formatPersonProgress('rallidae_', 2100, 'done')).toBe('rallidae_ · 100% · 2,100개');
    expect(
      renderPersonList([
        { name: 'rallidae_', count: 2100, state: 'done' },
        { name: '스쿠루', count: 1600, state: 'active' },
        { name: '민수', count: 0, state: 'waiting' },
      ]),
    ).toBe('1. 스쿠루 · 수집 중 · 1,600개\n2. 민수 · 대기 중 · 0개\n3. rallidae_ · 100% · 2,100개');
  });

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
