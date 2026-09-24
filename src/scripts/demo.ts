import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { randomMasterKey } from '../security/crypto.js';
import { normalizeMessage } from '../discord/normalize.js';
import { searchMessages, type SearchFilters } from '../search/query.js';
import { makeSnippet } from '../search/snippet.js';
import { UserDirectory, type StoredMessage } from '../store/userStore.js';

const filters: SearchFilters = { author: 'all', kind: 'all', period: 'all' };

function seed(users: UserDirectory): void {
  const store = users.get('100000000000000001');
  store.upsertChannel({
    id: '111',
    type: 1,
    recipientId: '222',
    recipientName: '민수',
    lastMessageId: null,
    newestSyncedId: null,
    oldestSyncedId: null,
    backfillDone: true,
    messageCount: 0,
    tracked: true,
  });
  store.upsertChannel({
    id: '333',
    type: 1,
    recipientId: '444',
    recipientName: '지연',
    lastMessageId: null,
    newestSyncedId: null,
    oldestSyncedId: null,
    backfillDone: true,
    messageCount: 0,
    tracked: true,
  });
  const specials = [
    normalizeMessage(
      {
        id: '9001',
        content: '이거 봐바 https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        timestamp: '2024-03-12T06:21:00.000Z',
        author: { id: '222', username: 'minsu', global_name: '민수' },
        embeds: [{ title: '아이유 - 밤편지 (Live)', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: { name: 'YouTube' } }],
      },
      '111',
    ),
    normalizeMessage(
      {
        id: '9002',
        content: '내일 회의록이야. 장소는 회사.',
        timestamp: '2024-04-02T03:00:00.000Z',
        author: { id: '100000000000000001', username: 'me', global_name: '나' },
      },
      '111',
    ),
    normalizeMessage(
      {
        id: '9003',
        content: '저번에 노래 추천해줬던 거 다시 듣고 싶어',
        timestamp: '2024-04-03T03:00:00.000Z',
        author: { id: '444', username: 'jiyeon', global_name: '지연' },
      },
      '333',
    ),
    normalizeMessage(
      {
        id: '9004',
        content: '😎 이모지도 검색돼?',
        timestamp: '2024-04-04T03:00:00.000Z',
        author: { id: '222', username: 'minsu', global_name: '민수' },
        attachments: [{ filename: 'setlist.txt', size: 20, content_type: 'text/plain' }],
      },
      '111',
    ),
  ].filter((item): item is StoredMessage => item != null);

  const filler: StoredMessage[] = [];
  for (let index = 0; index < 3000; index += 1) {
    const channelId = index % 2 === 0 ? '111' : '333';
    filler.push({
      id: String(10_000 + index),
      channelId,
      authorId: index % 3 === 0 ? '100000000000000001' : channelId === '111' ? '222' : '444',
      authorName: index % 3 === 0 ? '나' : channelId === '111' ? '민수' : '지연',
      content: `일상 메시지 ${index} 오늘 날씨 좋다`,
      searchText: `일상 메시지 ${index} 오늘 날씨 좋다`,
      ts: Date.parse('2023-01-01T00:00:00.000Z') + index * 60_000,
      editedTs: null,
      hasLink: false,
      hasImage: false,
      hasFile: false,
      hasYoutube: false,
      attachments: [],
    });
  }
  store.upsertMessages([...specials, ...filler]);
}

function printResult(db: ReturnType<UserDirectory['get']>['db'], raw: string): number {
  const result = searchMessages(db, { raw, requesterId: '100000000000000001', filters, page: 0 });
  console.log(`\n🔍 ${raw} · ${result.total}개`);
  for (const hit of result.hits) {
    console.log(`- ${hit.authorName}: ${makeSnippet(hit, result.terms)}`);
  }
  return result.total;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'geugeo-demo-'));
  const users = new UserDirectory(dir, randomMasterKey());
  seed(users);
  const db = users.get('100000000000000001').db;
  const check = process.argv.includes('--check') || !process.stdin.isTTY;
  if (check) {
    const youtube = printResult(db, 'youtube');
    const meeting = printResult(db, '회의');
    users.closeAll();
    if (youtube < 1 || meeting < 1) {
      console.error('기대했던 검색 결과가 없어요.');
      process.exit(1);
    }
    console.log('\n확인했어요. youtube와 회의가 모두 검색됩니다.');
    return;
  }
  console.log('검색어를 입력하세요. 종료는 Ctrl+D.');
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '검색> ' });
  rl.prompt();
  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) {
      rl.prompt();
      continue;
    }
    try {
      printResult(db, raw);
    } catch (error) {
      console.error(error instanceof Error ? error.message : '검색에 실패했어요.');
    }
    rl.prompt();
  }
  users.closeAll();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
