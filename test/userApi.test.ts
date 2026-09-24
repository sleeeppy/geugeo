import { afterEach, describe, expect, it } from 'vitest';
import {
  ForbiddenRequestError,
  TokenInvalidError,
  UserApi,
  assertAllowed,
  resetUserApiQueue,
} from '../src/discord/userApi.js';

afterEach(() => resetUserApiQueue());

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('userApi allow list', () => {
  it('rejects methods, paths, and queries before any request', async () => {
    const fetchImpl = () => {
      throw new Error('fetch should not be called');
    };
    const api = new UserApi({ delayMs: 0, jitterMs: 0, fetchImpl });
    expect(() => assertAllowed('POST', '/users/@me')).toThrow(ForbiddenRequestError);
    expect(() => assertAllowed('GET', '/users/@me/settings')).toThrow(ForbiddenRequestError);
    expect(() => assertAllowed('GET', '/users/@me/guilds')).not.toThrow();
    expect(() => assertAllowed('GET', '/guilds/123456/channels')).not.toThrow();
    expect(() => assertAllowed('GET', '/channels/123456/messages', { limit: 10, before: '1', content: 'x' } as never)).toThrow(
      ForbiddenRequestError,
    );
    expect(() => api.getMessages('token', 'not-an-id')).toThrow(ForbiddenRequestError);
  });

  it('waits for retry_after on 429', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { retry_after: 0.4, global: true });
      return jsonResponse(200, { id: '9', username: 'me' });
    };
    const api = new UserApi({
      delayMs: 0,
      jitterMs: 0,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const me = await api.getMe('token');
    expect(me.id).toBe('9');
    expect(sleeps).toContain(400);
  });

  it('throws TokenInvalidError on 401', async () => {
    const api = new UserApi({
      delayMs: 0,
      jitterMs: 0,
      fetchImpl: async () => jsonResponse(401, { message: '401: Unauthorized' }),
      sleep: async () => undefined,
    });
    await expect(api.getMe('token')).rejects.toBeInstanceOf(TokenInvalidError);
  });
});
