import { describe, expect, it, vi } from 'vitest';
import { createLogger, maskSecrets, sanitize } from '../src/log.js';

describe('logger', () => {
  it('masks tokens and message bodies', () => {
    const token = `${'a'.repeat(24)}.${'b'.repeat(6)}.${'c'.repeat(27)}`;
    expect(maskSecrets(`받은 값 ${token}`)).not.toContain(token);
    const sanitized = sanitize({ content: '비밀 대화', search_text: 'youtube', token, note: token }) as {
      content: string;
      search_text: string;
      token: string;
      note: string;
    };
    expect(sanitized.content).toBe('[redacted]');
    expect(sanitized.search_text).toBe('[redacted]');
    expect(sanitized.token).toBe('[redacted]');
    expect(sanitized.note).not.toContain('a'.repeat(24));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createLogger('error').error('실패', { content: '대화 본문', authorization: token });
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('대화 본문');
    expect(String(spy.mock.calls[0]?.[0])).not.toContain(token);
    spy.mockRestore();
  });
});
