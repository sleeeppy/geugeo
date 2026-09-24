import { describe, expect, it } from 'vitest';
import { normalizeMessage, type ApiMessage } from '../src/discord/normalize.js';

function base(partial: Partial<ApiMessage>): ApiMessage {
  return {
    id: '100',
    type: 0,
    content: '',
    timestamp: '2024-03-12T06:21:00.000Z',
    author: { id: '2', username: 'minsu', global_name: '민수' },
    ...partial,
  };
}

describe('normalize', () => {
  it('skips system messages', () => {
    expect(normalizeMessage(base({ type: 7, content: '통화' }), '10')).toBeNull();
    expect(normalizeMessage(base({ type: 6, content: '고정' }), '10')).toBeNull();
  });

  it('keeps replies and sets flags', () => {
    const stored = normalizeMessage(
      base({
        type: 19,
        content: '이거 봐바 https://www.youtube.com/watch?v=abc',
        attachments: [
          { filename: 'notes.pdf', size: 12, content_type: 'application/pdf' },
          { filename: 'pic.png', size: 20, content_type: 'image/png' },
        ],
        embeds: [{ title: '아이유 - 밤편지', url: 'https://www.youtube.com/watch?v=abc', provider: { name: 'YouTube' } }],
      }),
      '10',
    );
    expect(stored).not.toBeNull();
    expect(stored?.hasLink).toBe(true);
    expect(stored?.hasYoutube).toBe(true);
    expect(stored?.hasImage).toBe(true);
    expect(stored?.hasFile).toBe(true);
    expect(stored?.authorName).toBe('민수');
    expect(stored?.searchText).toContain('notes.pdf');
    expect(stored?.searchText).toContain('아이유 - 밤편지');
    expect(stored?.searchText).toContain('YouTube');
    expect(stored?.attachments[0]?.name).toBe('notes.pdf');
    expect(JSON.stringify(stored?.attachments)).not.toContain('http');
  });

  it('includes forwarded message content', () => {
    const stored = normalizeMessage(
      base({
        content: '전달',
        message_snapshots: [{ message: { content: '원래는 회의록이야' } }],
      }),
      '10',
    );
    expect(stored?.searchText).toContain('원래는 회의록이야');
  });
});
