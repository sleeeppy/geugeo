export class TokenInvalidError extends Error {
  constructor() {
    super('계정 토큰이 거부됐어요.');
    this.name = 'TokenInvalidError';
  }
}

export class UserApiError extends Error {
  readonly status: number;

  constructor(status: number, message = '디스코드 요청에 실패했어요.') {
    super(message);
    this.name = 'UserApiError';
    this.status = status;
  }
}

export class ForbiddenRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenRequestError';
  }
}

const BASE = 'https://discord.com/api/v9';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface UserApiOptions {
  delayMs?: number;
  jitterMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Query {
  limit?: number;
  before?: string;
  after?: string;
}

let requestChain: Promise<void> = Promise.resolve();
let pausedUntil = 0;

export function resetUserApiQueue(): void {
  requestChain = Promise.resolve();
  pausedUntil = 0;
}

export class UserApi {
  private readonly delayMs: number;
  private readonly jitterMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: UserApiOptions = {}) {
    this.delayMs = options.delayMs ?? 1200;
    this.jitterMs = options.jitterMs ?? 600;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  getMe(token: string): Promise<{ id: string; username: string; global_name?: string | null }> {
    return this.request(token, 'GET', '/users/@me');
  }

  getChannels(token: string): Promise<ApiChannel[]> {
    return this.request(token, 'GET', '/users/@me/channels');
  }

  getMessages(token: string, channelId: string, query: Query = {}): Promise<ApiRawMessage[]> {
    assertSnowflake(channelId);
    return this.request(token, 'GET', `/channels/${channelId}/messages`, query);
  }

  getGuilds(token: string): Promise<ApiGuild[]> {
    return this.request(token, 'GET', '/users/@me/guilds');
  }

  getGuildChannels(token: string, guildId: string): Promise<ApiGuildChannel[]> {
    assertSnowflake(guildId);
    return this.request(token, 'GET', `/guilds/${guildId}/channels`);
  }

  private request<T>(token: string, method: string, path: string, query?: Query): Promise<T> {
    assertAllowed(method, path, query);
    const run = requestChain.then(() => this.perform<T>(token, method, path, query));
    requestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async perform<T>(token: string, method: string, path: string, query?: Query): Promise<T> {
    let failures = 0;
    while (true) {
      const pause = pausedUntil - this.now();
      if (pause > 0) await this.sleep(pause);
      const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * (this.jitterMs + 1)) : 0;
      if (this.delayMs + jitter > 0) await this.sleep(this.delayMs + jitter);
      const url = new URL(BASE + path);
      if (query?.limit != null) url.searchParams.set('limit', String(query.limit));
      if (query?.before) url.searchParams.set('before', query.before);
      if (query?.after) url.searchParams.set('after', query.after);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: token,
            'User-Agent': USER_AGENT,
          },
        });
      } catch (error) {
        failures += 1;
        if (failures >= 5) throw new UserApiError(0, '네트워크 오류가 반복됐어요.');
        await this.sleep(Math.min(30_000, 500 * 2 ** (failures - 1)));
        continue;
      }
      if (response.status === 401) throw new TokenInvalidError();
      if (response.status === 403 || response.status === 404) {
        throw new UserApiError(response.status, '채널을 읽을 수 없어요.');
      }
      if (response.status === 429) {
        const body = (await response.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
        const wait = Math.ceil(Number(body.retry_after ?? 1) * 1000);
        if (body.global) pausedUntil = Math.max(pausedUntil, this.now() + wait);
        failures += 1;
        if (failures >= 5) throw new UserApiError(429, '요청이 너무 많아 동기화를 멈췄어요.');
        await this.sleep(wait);
        continue;
      }
      if (response.status >= 500) {
        failures += 1;
        if (failures >= 5) throw new UserApiError(response.status);
        await this.sleep(Math.min(30_000, 500 * 2 ** (failures - 1)));
        continue;
      }
      if (!response.ok) throw new UserApiError(response.status);
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const resetAfter = response.headers.get('X-RateLimit-Reset-After');
      if (remaining === '0' && resetAfter) {
        pausedUntil = Math.max(pausedUntil, this.now() + Math.ceil(Number(resetAfter) * 1000));
      }
      return (await response.json()) as T;
    }
  }
}

export function assertAllowed(method: string, path: string, query?: Query): void {
  if (method !== 'GET') {
    throw new ForbiddenRequestError('읽기 외의 요청은 허용되지 않아요.');
  }
  const allowedPath =
    path === '/users/@me' ||
    path === '/users/@me/channels' ||
    path === '/users/@me/guilds' ||
    /^\/channels\/\d{5,22}\/messages$/.test(path) ||
    /^\/guilds\/\d{5,22}\/channels$/.test(path);
  if (!allowedPath) throw new ForbiddenRequestError('허용되지 않은 경로예요.');
  if (!query) return;
  const keys = Object.keys(query).filter((key) => query[key as keyof Query] != null);
  for (const key of keys) {
    if (key !== 'limit' && key !== 'before' && key !== 'after') {
      throw new ForbiddenRequestError('허용되지 않은 조회 조건이에요.');
    }
  }
}

function assertSnowflake(id: string): void {
  if (!/^\d{5,22}$/.test(id)) throw new ForbiddenRequestError('채널 ID 형식이 올바르지 않아요.');
}

export interface ApiChannel {
  id: string;
  type: number;
  last_message_id?: string | null;
  recipients?: Array<{ id: string; username: string; global_name?: string | null }>;
}

export interface ApiGuild {
  id: string;
  name: string;
}

export interface ApiGuildChannel {
  id: string;
  type: number;
  name?: string;
  last_message_id?: string | null;
}

export interface ApiRawMessage {
  id: string;
  type?: number;
  channel_id?: string;
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  author?: { id?: string; username?: string; global_name?: string | null };
  attachments?: Array<{ filename?: string; size?: number; content_type?: string }>;
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
    type?: string;
    provider?: { name?: string };
    author?: { name?: string };
    fields?: Array<{ name?: string; value?: string }>;
  }>;
  sticker_items?: Array<{ name?: string }>;
  stickers?: Array<{ name?: string }>;
  message_snapshots?: Array<{ message?: { content?: string } }>;
}
