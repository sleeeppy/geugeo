import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomMasterKey } from '../src/security/crypto.js';
import { Registry } from '../src/store/registry.js';
import { UserDirectory, type StoredChannel, type StoredMessage } from '../src/store/userStore.js';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'geugeo-'));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function fixtureStore(): { dir: string; master: Buffer; users: UserDirectory; registry: Registry; close: () => void } {
  const dir = tempDir();
  const master = randomMasterKey();
  const users = new UserDirectory(dir, master);
  const registry = new Registry(dir, master);
  return {
    dir,
    master,
    users,
    registry,
    close: () => {
      users.closeAll();
      registry.close();
      cleanup(dir);
    },
  };
}

export function channel(partial: Partial<StoredChannel> & { id: string }): StoredChannel {
  return {
    type: 1,
    recipientId: '200',
    recipientName: '민수',
    lastMessageId: null,
    newestSyncedId: null,
    oldestSyncedId: null,
    backfillDone: false,
    messageCount: 0,
    ...partial,
  };
}

export function message(partial: Partial<StoredMessage> & { id: string }): StoredMessage {
  return {
    channelId: '10',
    authorId: '200',
    authorName: '민수',
    content: '',
    searchText: partial.searchText ?? partial.content ?? '',
    ts: 1_700_000_000_000,
    editedTs: null,
    hasLink: false,
    hasImage: false,
    hasFile: false,
    hasYoutube: false,
    attachments: [],
    ...partial,
  };
}
