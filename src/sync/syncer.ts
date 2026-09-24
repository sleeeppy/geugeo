import type { Logger } from '../log.js';
import { normalizeMessage } from '../discord/normalize.js';
import { TokenInvalidError, UserApiError, type ApiChannel, type ApiRawMessage, type UserApi } from '../discord/userApi.js';
import type { Registry } from '../store/registry.js';
import { decryptSecret, tokenKey } from '../security/crypto.js';
import type { StoredChannel, StoredMessage, UserDirectory } from '../store/userStore.js';

export interface SyncerOptions {
  registry: Registry;
  users: UserDirectory;
  api: Pick<UserApi, 'getChannels' | 'getMessages'>;
  masterKey: Buffer;
  log: Logger;
  onSynced?: (userId: string) => void;
}

export class Syncer {
  private readonly inflight = new Set<string>();

  constructor(private readonly options: SyncerOptions) {}

  async backfillUser(userId: string): Promise<void> {
    const token = this.readToken(userId);
    if (!token) return;
    this.options.registry.setStatus(userId, 'syncing');
    try {
      const channels = await this.refreshChannels(userId, token);
      const ordered = [...channels].sort((a, b) => compareId(b.lastMessageId, a.lastMessageId));
      let messages = 0;
      let done = 0;
      for (const channel of ordered) {
        const count = await this.backfillChannel(userId, token, channel.id);
        messages += count;
        done += 1;
        this.options.registry.setProgress(userId, { channelsDone: done, channelsTotal: ordered.length, messages });
      }
      this.options.registry.setStatus(userId, 'ready');
      this.options.registry.setLastSync(userId);
      this.options.onSynced?.(userId);
    } catch (error) {
      this.handleFailure(userId, error);
    }
  }

  async incrementalUser(userId: string): Promise<void> {
    const token = this.readToken(userId);
    if (!token) return;
    try {
      const channels = await this.refreshChannels(userId, token);
      for (const channel of channels) {
        if (!channel.backfillDone) {
          await this.backfillChannel(userId, token, channel.id);
          continue;
        }
        if (channel.lastMessageId && channel.lastMessageId !== channel.newestSyncedId) {
          await this.incrementalChannel(userId, channel.id);
        }
      }
      this.options.registry.setStatus(userId, 'ready');
      this.options.registry.setLastSync(userId);
      this.options.onSynced?.(userId);
    } catch (error) {
      this.handleFailure(userId, error);
    }
  }

  async incrementalChannel(userId: string, channelId: string): Promise<void> {
    const key = `${userId}:${channelId}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const token = this.readToken(userId);
      if (!token) return;
      const store = this.options.users.get(userId);
      const channel = store.getChannel(channelId);
      if (!channel?.newestSyncedId || !channel.backfillDone) {
        await this.backfillChannel(userId, token, channelId);
        return;
      }
      let after = channel.newestSyncedId;
      while (true) {
        const page = sortById(await this.options.api.getMessages(token, channelId, { limit: 100, after }));
        if (page.length === 0) break;
        const stored = this.storePage(userId, channelId, page);
        const maxId = stored[stored.length - 1]?.id ?? after;
        if (compareId(maxId, after) <= 0) break;
        after = maxId;
        store.updateChannelCursor({ id: channelId, newestSyncedId: maxId });
        if (page.length < 100) break;
      }
    } catch (error) {
      this.handleFailure(userId, error);
    } finally {
      this.inflight.delete(key);
    }
  }

  async backfillChannel(userId: string, token: string, channelId: string): Promise<number> {
    const store = this.options.users.get(userId);
    const existing = store.getChannel(channelId);
    const fromScratch = !existing?.oldestSyncedId;
    if (fromScratch) store.clearBackfillSeen(channelId);
    let before = existing?.oldestSyncedId ?? undefined;
    let newest = existing?.newestSyncedId ?? null;
    let count = existing?.messageCount ?? 0;
    while (true) {
      let page: ApiRawMessage[];
      try {
        page = await this.options.api.getMessages(token, channelId, { limit: 100, before });
      } catch (error) {
        if (error instanceof UserApiError && (error.status === 403 || error.status === 404)) {
          this.options.log.warn('채널을 건너뛰어요.', { userId, channelId, status: error.status });
          store.updateChannelCursor({ id: channelId, backfillDone: true });
          return count;
        }
        throw error;
      }
      if (page.length === 0) {
        if (fromScratch) store.deleteUnseenMessages(channelId);
        store.updateChannelCursor({ id: channelId, backfillDone: true, oldestSyncedId: before ?? existing?.oldestSyncedId ?? null, newestSyncedId: newest });
        return count;
      }
      const stored = this.storePage(userId, channelId, page);
      if (fromScratch) store.markBackfillSeen(channelId, stored.map((message) => message.id));
      const ids = page.map((message) => message.id);
      const minId = ids.reduce((min, id) => (compareId(id, min) < 0 ? id : min));
      const maxId = ids.reduce((max, id) => (compareId(id, max) > 0 ? id : max));
      before = minId;
      newest = newest && compareId(newest, maxId) > 0 ? newest : maxId;
      count = store.countMessages(channelId);
      store.updateChannelCursor({ id: channelId, oldestSyncedId: before, newestSyncedId: newest, backfillDone: false, messageCount: count });
    }
  }

  resumeIncomplete(): string[] {
    const pending: string[] = [];
    for (const user of this.options.registry.list()) {
      if (!user.tokenEnc) continue;
      if (!this.options.users.hasFile(user.userId)) {
        pending.push(user.userId);
        continue;
      }
      const channels = this.options.users.get(user.userId).listChannels();
      if (channels.length === 0 || channels.some((channel) => !channel.backfillDone)) pending.push(user.userId);
    }
    return pending;
  }

  private refreshChannels(userId: string, token: string): Promise<StoredChannel[]> {
    return this.options.api.getChannels(token).then((channels) => {
      const store = this.options.users.get(userId);
      for (const channel of channels.filter(isDirectMessage)) {
        const recipient = channel.recipients?.[0];
        const current = store.getChannel(channel.id);
        store.upsertChannel({
          id: channel.id,
          type: 1,
          recipientId: recipient?.id ?? '',
          recipientName: recipient?.global_name || recipient?.username || '알 수 없음',
          lastMessageId: channel.last_message_id ?? null,
          newestSyncedId: current?.newestSyncedId ?? null,
          oldestSyncedId: current?.oldestSyncedId ?? null,
          backfillDone: current?.backfillDone ?? false,
          messageCount: current?.messageCount ?? 0,
        });
        if (channel.last_message_id) {
          store.updateChannelCursor({ id: channel.id, lastMessageId: channel.last_message_id });
        }
      }
      return store.listChannels().filter((channel) => channel.type === 1);
    });
  }

  private storePage(userId: string, channelId: string, page: ApiRawMessage[]): StoredMessage[] {
    const stored = sortById(page)
      .map((message) => normalizeMessage(message, channelId))
      .filter((message): message is StoredMessage => message != null);
    this.options.users.get(userId).upsertMessages(stored);
    return stored;
  }

  private readToken(userId: string): string | null {
    const user = this.options.registry.get(userId);
    if (!user?.tokenEnc) return null;
    return decryptSecret(tokenKey(this.options.masterKey), user.tokenEnc, userId);
  }

  private handleFailure(userId: string, error: unknown): void {
    if (error instanceof TokenInvalidError) {
      this.options.registry.clearToken(userId);
      this.options.log.warn('토큰이 만료되어 삭제했어요.', { userId });
      return;
    }
    const message = error instanceof Error ? error.message : '동기화에 실패했어요.';
    this.options.registry.setStatus(userId, 'error', message);
    this.options.log.error('동기화에 실패했어요.', { userId, error });
  }
}

function isDirectMessage(channel: ApiChannel): boolean {
  return channel.type === 1;
}

function sortById(messages: ApiRawMessage[]): ApiRawMessage[] {
  return [...messages].sort((a, b) => compareId(a.id, b.id));
}

function compareId(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function resetFullSync(syncer: Syncer, users: UserDirectory, userId: string): Promise<void> {
  const store = users.get(userId);
  for (const channel of store.listChannels()) {
    store.updateChannelCursor({ id: channel.id, oldestSyncedId: null, newestSyncedId: null, backfillDone: false });
    store.clearBackfillSeen(channel.id);
  }
  await syncer.backfillUser(userId);
}
