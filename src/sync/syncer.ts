import type { Logger } from '../log.js';
import { normalizeMessage } from '../discord/normalize.js';
import { TokenInvalidError, UserApiError, type ApiChannel, type ApiRawMessage, type UserApi } from '../discord/userApi.js';
import type { Registry } from '../store/registry.js';
import { decryptSecret, tokenKey } from '../security/crypto.js';
import type { StoredMessage, UserDirectory } from '../store/userStore.js';

export interface SyncerOptions {
  registry: Registry;
  users: UserDirectory;
  api: Pick<UserApi, 'getChannels' | 'getMessages'>;
  masterKey: Buffer;
  log: Logger;
  onSynced?: (userId: string) => void;
}

class SyncStopped extends Error {
  constructor() {
    super('수집을 멈췄어요.');
    this.name = 'SyncStopped';
  }
}

export class Syncer {
  private readonly inflight = new Set<string>();
  private readonly cancel = new Set<string>();

  requestStop(userId: string): void {
    this.cancel.add(userId);
  }

  clearStop(userId: string): void {
    this.cancel.delete(userId);
  }

  constructor(private readonly options: SyncerOptions) {}

  async beginCollect(userId: string, channelId: string): Promise<string | null> {
    const token = this.readToken(userId);
    if (!token) return null;
    let channels;
    try {
      channels = await this.options.api.getChannels(token);
    } catch (error) {
      this.handleFailure(userId, error);
      throw error;
    }
    const remote = channels.find((channel) => isDirectMessage(channel) && channel.id === channelId);
    if (!remote) return null;
    const store = this.options.users.get(userId);
    const current = store.getChannel(channelId);
    const recipient = remote.recipients?.[0];
    const name = recipient?.global_name || recipient?.username || '알 수 없음';
    store.upsertChannel({
      id: remote.id,
      type: 1,
      recipientId: recipient?.id ?? '',
      recipientName: name,
      lastMessageId: remote.last_message_id ?? null,
      newestSyncedId: current?.newestSyncedId ?? null,
      oldestSyncedId: current?.oldestSyncedId ?? null,
      backfillDone: current?.backfillDone ?? false,
      messageCount: current?.messageCount ?? 0,
      tracked: true,
    });
    this.options.registry.setStatus(userId, 'syncing');
    this.options.registry.setProgress(userId, { channelsDone: 0, channelsTotal: 1, messages: current?.messageCount ?? 0 });
    return name;
  }

  async beginCollectAll(userId: string): Promise<number> {
    const token = this.readToken(userId);
    if (!token) return 0;
    let channels;
    try {
      channels = await this.options.api.getChannels(token);
    } catch (error) {
      this.handleFailure(userId, error);
      throw error;
    }
    const dms = channels.filter(isDirectMessage);
    const store = this.options.users.get(userId);
    for (const remote of dms) {
      const current = store.getChannel(remote.id);
      const recipient = remote.recipients?.[0];
      store.upsertChannel({
        id: remote.id,
        type: 1,
        recipientId: recipient?.id ?? '',
        recipientName: recipient?.global_name || recipient?.username || '알 수 없음',
        lastMessageId: remote.last_message_id ?? null,
        newestSyncedId: current?.newestSyncedId ?? null,
        oldestSyncedId: current?.oldestSyncedId ?? null,
        backfillDone: current?.backfillDone ?? false,
        messageCount: current?.messageCount ?? 0,
        tracked: true,
      });
    }
    this.options.registry.setStatus(userId, 'syncing');
    this.options.registry.setProgress(userId, { channelsDone: 0, channelsTotal: dms.length, messages: store.countMessages() });
    return dms.length;
  }

  async collectAll(userId: string): Promise<void> {
    const token = this.readToken(userId);
    if (!token) return;
    const store = this.options.users.get(userId);
    try {
      this.haltIfStopped(userId);
      this.options.registry.setStatus(userId, 'syncing');
      const ordered = store.listTracked().sort((a, b) => compareId(b.lastMessageId, a.lastMessageId));
      let done = 0;
      for (const channel of ordered) {
        this.haltIfStopped(userId);
        const fresh = store.getChannel(channel.id) ?? channel;
        if (!fresh.backfillDone) {
          await this.backfillChannel(userId, token, fresh.id, () => {
            this.options.registry.setProgress(userId, {
              channelsDone: done,
              channelsTotal: ordered.length,
              messages: store.countMessages(),
            });
          });
        } else if (fresh.lastMessageId && fresh.lastMessageId !== fresh.newestSyncedId) {
          await this.incrementalChannel(userId, fresh.id);
        }
        done += 1;
        this.options.registry.setProgress(userId, {
          channelsDone: done,
          channelsTotal: ordered.length,
          messages: store.countMessages(),
        });
      }
      this.haltIfStopped(userId);
      this.finish(userId);
    } catch (error) {
      this.handleFailure(userId, error);
    }
  }

  async collectChannel(userId: string, channelId: string): Promise<void> {
    const token = this.readToken(userId);
    if (!token) return;
    const store = this.options.users.get(userId);
    if (!store.getChannel(channelId)?.tracked) return;
    try {
      this.haltIfStopped(userId);
      this.options.registry.setStatus(userId, 'syncing');
      await this.backfillChannel(userId, token, channelId, (messages) => {
        this.options.registry.setProgress(userId, { channelsDone: 0, channelsTotal: 1, messages });
      });
      this.haltIfStopped(userId);
      const current = store.getChannel(channelId);
      if (current?.backfillDone) await this.incrementalChannel(userId, channelId);
      this.haltIfStopped(userId);
      this.options.registry.setProgress(userId, { channelsDone: 1, channelsTotal: 1, messages: store.countMessages(channelId) });
      this.finish(userId);
    } catch (error) {
      this.handleFailure(userId, error);
    }
  }

  async backfillUser(userId: string): Promise<void> {
    const token = this.readToken(userId);
    if (!token) return;
    const pending = this.options.users.get(userId).listTracked().filter((channel) => !channel.backfillDone);
    if (pending.length === 0) return;
    this.options.registry.setStatus(userId, 'syncing');
    try {
      await this.refreshTracked(userId, token);
      const ordered = this.options.users
        .get(userId)
        .listTracked()
        .filter((channel) => !channel.backfillDone)
        .sort((a, b) => compareId(b.lastMessageId, a.lastMessageId));
      let messages = 0;
      let done = 0;
      for (const channel of ordered) {
        this.haltIfStopped(userId);
        const count = await this.backfillChannel(userId, token, channel.id);
        messages += count;
        done += 1;
        this.options.registry.setProgress(userId, { channelsDone: done, channelsTotal: ordered.length, messages });
      }
      this.haltIfStopped(userId);
      this.finish(userId);
    } catch (error) {
      this.handleFailure(userId, error);
    }
  }

  async incrementalUser(userId: string): Promise<void> {
    const token = this.readToken(userId);
    if (!token) return;
    try {
      await this.refreshTracked(userId, token);
      const channels = this.options.users.get(userId).listTracked();
      if (channels.length === 0) return;
      for (const channel of channels) {
        this.haltIfStopped(userId);
        if (!channel.backfillDone) {
          await this.backfillChannel(userId, token, channel.id);
          continue;
        }
        if (channel.lastMessageId && channel.lastMessageId !== channel.newestSyncedId) {
          await this.incrementalChannel(userId, channel.id);
        }
      }
      this.haltIfStopped(userId);
      this.finish(userId);
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
      if (!channel?.tracked) return;
      if (!channel.newestSyncedId || !channel.backfillDone) {
        await this.backfillChannel(userId, token, channelId);
        return;
      }
      let after = channel.newestSyncedId;
      while (true) {
        this.haltIfStopped(userId);
        const page = sortById(await this.options.api.getMessages(token, channelId, { limit: 100, after }));
        this.haltIfStopped(userId);
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
      if (error instanceof SyncStopped) throw error;
    } finally {
      this.inflight.delete(key);
    }
  }

  async backfillChannel(userId: string, token: string, channelId: string, onPage?: (count: number) => void): Promise<number> {
    const store = this.options.users.get(userId);
    const existing = store.getChannel(channelId);
    const fromScratch = !existing?.oldestSyncedId;
    if (fromScratch) store.clearBackfillSeen(channelId);
    let before = existing?.oldestSyncedId ?? undefined;
    let newest = existing?.newestSyncedId ?? null;
    let count = existing?.messageCount ?? 0;
    while (true) {
      this.haltIfStopped(userId);
      let page: ApiRawMessage[];
      try {
        page = await this.options.api.getMessages(token, channelId, { limit: 100, before });
        this.haltIfStopped(userId);
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
      onPage?.(count);
    }
  }

  resumeIncomplete(): string[] {
    const pending: string[] = [];
    for (const user of this.options.registry.list()) {
      if (!user.tokenEnc || user.status === 'paused') continue;
      if (!this.options.users.hasFile(user.userId)) continue;
      const channels = this.options.users.get(user.userId).listTracked();
      if (channels.some((channel) => !channel.backfillDone)) pending.push(user.userId);
    }
    return pending;
  }

  settleIdle(): void {
    for (const user of this.options.registry.list()) {
      if (user.status !== 'syncing') continue;
      const pending =
        this.options.users.hasFile(user.userId) &&
        this.options.users.get(user.userId).listTracked().some((channel) => !channel.backfillDone);
      if (pending) continue;
      this.options.registry.setStatus(user.userId, 'ready');
      this.options.registry.clearProgress(user.userId);
    }
  }

  private finish(userId: string): void {
    this.options.registry.setStatus(userId, 'ready');
    this.options.registry.setLastSync(userId);
    this.options.onSynced?.(userId);
  }

  private async refreshTracked(userId: string, token: string): Promise<void> {
    const listed = await this.options.api.getChannels(token);
    const store = this.options.users.get(userId);
    for (const current of store.listTracked()) {
      const remote = listed.find((channel) => channel.id === current.id && isDirectMessage(channel));
      if (!remote) continue;
      const recipient = remote.recipients?.[0];
      store.upsertChannel({
        ...current,
        recipientId: recipient?.id ?? current.recipientId,
        recipientName: recipient?.global_name || recipient?.username || current.recipientName,
        lastMessageId: remote.last_message_id ?? current.lastMessageId,
        tracked: true,
      });
      if (remote.last_message_id) {
        store.updateChannelCursor({ id: current.id, lastMessageId: remote.last_message_id });
      }
    }
  }

  private storePage(userId: string, channelId: string, page: ApiRawMessage[]): StoredMessage[] {
    if (this.cancel.has(userId)) return [];
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

  private haltIfStopped(userId: string): void {
    if (!this.cancel.has(userId)) return;
    this.cancel.delete(userId);
    this.options.registry.setStatus(userId, 'paused');
    throw new SyncStopped();
  }

  private handleFailure(userId: string, error: unknown): void {
    if (error instanceof SyncStopped) return;
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
  for (const channel of store.listTracked()) {
    store.updateChannelCursor({ id: channel.id, oldestSyncedId: null, newestSyncedId: null, backfillDone: false });
    store.clearBackfillSeen(channel.id);
  }
  await syncer.backfillUser(userId);
}
