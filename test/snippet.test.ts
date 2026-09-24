import { describe, expect, it } from 'vitest';
import { makeSnippet } from '../src/search/snippet.js';

describe('snippet', () => {
  it('escapes discord markdown outside the match', () => {
    const text = makeSnippet({ content: '*기울임* youtube _밑줄_', searchText: '*기울임* youtube _밑줄_', attachments: [] }, ['youtube']);
    expect(text).toContain('\\*기울임\\*');
    expect(text).toContain('\\_밑줄\\_');
    expect(text).toContain('**youtube**');
  });

  it('does not put bold markers inside a URL', () => {
    const text = makeSnippet(
      {
        content: '이거 봐바 https://www.youtube.com/watch?v=abcdefghijklmnopqrstuvwxyz0123456789',
        searchText: '이거 봐바 https://www.youtube.com/watch?v=abcdefghijklmnopqrstuvwxyz0123456789',
        attachments: [],
      },
      ['youtube'],
    );
    expect(text).not.toMatch(/https?:\/\/[^\s]*\*\*/);
    expect(text).not.toContain('**https');
    const urlish = text.match(/`https?:\/\/[^`]+`|<https?:\/\/[^>]+>/g) ?? [];
    for (const url of urlish) expect(url).not.toContain('**');
  });

  it('keeps the excerpt short', () => {
    const content = `${'가'.repeat(2000)} youtube ${'나'.repeat(2000)}`;
    const text = makeSnippet({ content, searchText: content, attachments: [] }, ['youtube']);
    expect(text.length).toBeLessThan(250);
    expect(text).toContain('youtube');
  });

  it('marks attachment and embed matches', () => {
    const file = makeSnippet(
      { content: '파일 보냄', searchText: '파일 보냄\n예산안.pdf', attachments: [{ name: '예산안.pdf', size: 1, contentType: null }] },
      ['예산안'],
    );
    expect(file.startsWith('📎')).toBe(true);
    const embed = makeSnippet(
      { content: '링크', searchText: '링크\n아이유 - 밤편지', attachments: [] },
      ['밤편지'],
    );
    expect(embed.startsWith('🔗')).toBe(true);
  });
});
