# 그거 — 구현 계획서

> "그때 보낸 **그거** 뭐였지?"
> 디스코드 1:1 DM을 **제대로** 검색하는 유저 설치형 봇. 그 사람과의 DM에서 `/그거 youtube`를 입력하면 그 대화만 찾고, `/그거뭐지 youtube`는 수집해 둔 전체를 찾는다.

이 문서는 사용자와 합의한 요구사항과 설계를 담은 **구현 지시서**다. 구현자는 이 문서만 보고 처음부터 끝까지 만들 수 있어야 한다. 합의된 결정(§1)은 바꾸지 말고, 문서에 없는 세부 사항은 §14의 원칙에 따라 판단한다.

---

## 0. 현재 상태

| 항목 | 상태 |
|---|---|
| `package.json`, `tsconfig.json`, `.gitignore` | 작성 완료 (ESM, Node 22, TypeScript strict) |
| 의존성 설치 | `discord.js@14.27`, `better-sqlite3-multiple-ciphers@13.0.3`(SQLite 3.53.4 포함), `@huggingface/transformers@4.3`, dev: `typescript`, `tsx`, `vitest` |
| 기술 검증 | 아래 3가지를 실제 실행으로 확인 완료 |
| 소스 코드 | **없음.** §9 마일스톤 M1부터 시작 |

**검증 완료된 사실**
1. `fts5(..., tokenize='trigram')`로 `https://www.youtube.com/watch?v=abc` 안의 `youtube`가 `MATCH`로 검색된다.
2. 두 글자 한국어(`회의`)는 trigram `MATCH`로 안 잡히고 `LIKE '%회의%'`로 잡힌다. 따라서 **3글자 미만 검색어는 `LIKE` 경로가 필수**다.
3. `PRAGMA cipher='sqlcipher'; PRAGMA key=...`로 암호화한 DB는 키 없이 열면 `file is not a database` 에러가 난다.
4. discord.js 14.27에 `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `SeparatorBuilder`, `LabelBuilder`, `ApplicationIntegrationType`, `InteractionContextType`가 모두 있다.

---

## 1. 합의된 결정 (변경 금지)

| 주제 | 결정 |
|---|---|
| 이름 | **그거** (패키지명 `geugeo`) |
| 형태 | **디스코드 봇만** 사용. 사용자는 앱 추가만 하면 된다. PC 앱은 없다. |
| 설치 방식 | **유저 설치형 앱(User Install).** esmBot이나 Viggle처럼 계정에 설치하고, 모든 DM에서 `/` 명령어로 쓴다. |
| 검색 대상 | **1:1 DM이 최우선.** 나와 상대가 보낸 메시지를 **모두** 포함한다. 그룹 DM과 서버 채널은 이후 확장. |
| 기록 범위 | **사용자가 `/수집`한 1:1 DM만** 과거 전체를 모은다. `/연동`은 토큰만 저장하고 메시지를 가져오지 않는다. 이후 그 대화의 새 메시지는 자동 반영. |
| 데이터 수집 | 사용자가 **계정 토큰을 한 번 입력**하면 서버가 읽기 전용으로 수집한다. 사용자는 약관 위반 위험을 인지하고 수용했다. |
| 저장 | 서버의 SQLite. 사용자별로 **암호화된 파일**을 따로 둔다. |
| 검색 품질 | 한국어, 영어, 링크, 숫자 구분 없이 **입력한 글자가 들어간 모든 메시지**를 찾는다(부분 일치). |
| UI | **디스코드 UI와 최대한 통일감 있게.** Components V2 사용, 결과는 나에게만 보이는 메시지(ephemeral). |
| AI 검색 | **베타 기능.** 무료여야 하므로 서버 안에서 도는 로컬 임베딩 모델을 쓴다. 외부 AI API로 대화를 보내지 않는다. |
| 서버 | **Oracle Cloud Always Free** ARM 서버. 비용 0원. |
| 배포 대상 | 운영자의 **가까운 친구들만.** 허용 목록으로 제한한다. |
| 보안 | §5의 설계를 모두 구현한다. **외부에서 들어오는 포트를 열지 않는 구조**가 핵심이다. |
| 플랫폼 | 봇이라 윈도우, 맥, 모바일 디스코드 모두에서 동작한다. |

---

## 2. 전체 구조

```
┌──────────── 사용자의 디스코드 (Win / Mac / 모바일) ─────────────┐
│  DM 창에서  /검색 검색어:youtube                                │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Interaction (Gateway, 봇이 먼저 연결)
┌──────────────────────────────▼──────────────────────────────────┐
│  Oracle 무료 서버  (들어오는 포트 없음, SSH만 허용)               │
│                                                                 │
│  ┌── bot (discord.js) ──┐   ┌── sync worker ──────────────────┐ │
│  │ /검색 /ai검색 /연동   │   │ 계정 토큰으로 읽기 전용 요청    │ │
│  │ /연동해제 /상태       │◄─►│ GET /users/@me/channels         │ │
│  │ /동기화               │   │ GET /channels/{id}/messages     │ │
│  └─────────┬────────────┘   └──────────────┬──────────────────┘ │
│            │                               │                    │
│  ┌─────────▼───────────────────────────────▼──────────────────┐ │
│  │ data/registry.db   (암호화) 사용자 목록 + 암호화된 토큰      │ │
│  │ data/users/<id>.db (사용자별 암호화) 메시지 + trigram FTS    │ │
│  │                    + AI 임베딩                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│  마스터 키: systemd LoadCredential (DB, 코드와 분리)              │
└─────────────────────────────────────────────────────────────────┘
```

- 봇은 **Gateway로 먼저 연결**해서 Interaction을 받는다. 따라서 Interactions Endpoint URL(웹서버)이 필요 없고, 인바운드 포트를 열 일이 없다.
- 단일 Node 프로세스 안에 봇과 동기화 워커를 함께 둔다. 친구 몇 명 규모라 분리할 필요가 없다.

---

## 3. 디렉터리 구조

```
src/
  index.ts                 # 진입점: config 로드 → DB → bot 로그인 → 스케줄러 시작
  config.ts                # 환경변수와 마스터 키 로드, 검증
  log.ts                   # 로거 (토큰, 메시지 본문 자동 마스킹)
  security/
    crypto.ts              # HKDF 키 파생, AES-256-GCM 암호화/복호화
  store/
    registry.ts            # registry.db: users 테이블
    userStore.ts           # users/<id>.db: 스키마, upsert, 조회
    schema.sql.ts          # 스키마 SQL 문자열과 마이그레이션 버전
  discord/
    userApi.ts             # 계정 토큰용 읽기 전용 REST 클라이언트 (엔드포인트 허용 목록)
    normalize.ts           # API 메시지 → 저장용 레코드 (search_text 생성)
  sync/
    syncer.ts              # 전체 백필과 증분 동기화 (재개 가능)
    queue.ts               # 전역 단일 동시성 작업 큐
    scheduler.ts           # 주기적 증분 동기화
  search/
    query.ts               # 검색어 파싱, FTS/LIKE 경로 선택, 필터 SQL
    snippet.ts             # 매치 주변 발췌, 하이라이트, 마크다운 이스케이프
    semantic.ts            # AI 베타: 임베딩 생성, 코사인 검색
  bot/
    client.ts              # discord.js Client 생성, interaction 라우팅
    commands.ts            # 슬래시 커맨드 정의 (등록 스크립트와 공유)
    handlers/
      search.ts            # /검색, 페이지 넘김, 필터 변경
      aiSearch.ts          # /ai검색
      link.ts              # /연동 (안내 → 모달 → 검증 → 저장 → 동기화)
      unlink.ts            # /연동해제 (확인 버튼 → 완전 삭제)
      status.ts            # /상태
      sync.ts              # /동기화
    ui/
      theme.ts             # 색상, 이모지, 문구 상수
      results.ts           # 검색 결과 Components V2 빌더
      states.ts            # 빈 결과, 미연동, 동기화 중, 에러 화면
    sessions.ts            # 페이지네이션용 검색 세션 (메모리, TTL)
    guard.ts               # 허용 목록 확인
  scripts/
    registerCommands.ts    # 글로벌 커맨드 등록
    genKey.ts              # 마스터 키 생성
    demo.ts                # 가짜 DM 시드 + 터미널 검색 데모
test/                      # vitest
deploy/
  geugeo.service           # systemd 유닛
  setup-oracle.sh          # 서버 초기 설정 스크립트
.env.example
README.md
```

---

## 4. 데이터 모델

### 4.1 `data/registry.db` (암호화, 키 = `HKDF(master, "registry-db")`)

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id          TEXT PRIMARY KEY,     -- 디스코드 사용자 ID
  username         TEXT NOT NULL,
  token_enc        TEXT,                 -- AES-256-GCM, NULL이면 토큰 폐기됨
  status           TEXT NOT NULL,        -- 'syncing' | 'ready' | 'error' | 'token_invalid'
  progress_json    TEXT,                 -- {"channelsDone":3,"channelsTotal":12,"messages":48211}
  last_sync_at     INTEGER,
  last_error       TEXT,                 -- 사용자에게 보여줘도 되는 문구만 저장
  created_at       INTEGER NOT NULL
);
```

### 4.2 `data/users/<user_id>.db` (사용자별 암호화, 키 = `HKDF(master, "user-db:" + user_id)`)

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);  -- schema_version 등

CREATE TABLE IF NOT EXISTS channels (
  id                TEXT PRIMARY KEY,   -- DM 채널 ID (interaction.channelId와 동일)
  type              INTEGER NOT NULL,   -- 1 = DM (그룹 DM 3은 이후 확장)
  recipient_id      TEXT NOT NULL,
  recipient_name    TEXT NOT NULL,      -- global_name ?? username
  last_message_id   TEXT,               -- 채널 목록 API가 준 최신 메시지 ID
  newest_synced_id  TEXT,               -- 증분 동기화 기준점
  oldest_synced_id  TEXT,               -- 백필 재개 지점
  backfill_done     INTEGER NOT NULL DEFAULT 0,
  message_count     INTEGER NOT NULL DEFAULT 0,
  tracked           INTEGER NOT NULL DEFAULT 0  -- 1이면 /수집으로 고른 대화
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,        -- 스노플레이크
  channel_id   TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  search_text  TEXT NOT NULL,           -- §6.3 참고: 본문 + 링크 + 첨부 이름 + 임베드 제목 등
  ts           INTEGER NOT NULL,        -- 밀리초
  edited_ts    INTEGER,
  has_link     INTEGER NOT NULL DEFAULT 0,
  has_image    INTEGER NOT NULL DEFAULT 0,
  has_file     INTEGER NOT NULL DEFAULT 0,
  has_youtube  INTEGER NOT NULL DEFAULT 0,
  attachments  TEXT                     -- JSON [{name, size, contentType}] (URL은 만료되므로 저장 안 함)
);
CREATE INDEX IF NOT EXISTS idx_msg_channel_ts ON messages(channel_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_msg_author ON messages(channel_id, author_id, ts DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  search_text, content='messages', content_rowid='rowid', tokenize='trigram'
);
-- external content FTS 동기화 트리거 (insert / delete / update 3종)

CREATE TABLE IF NOT EXISTS embeddings (
  message_id TEXT PRIMARY KEY,
  vec        BLOB NOT NULL             -- Float32Array(384), L2 정규화
);
```

**반드시 지킬 것**
- upsert는 `INSERT ... ON CONFLICT(id) DO UPDATE`로 한다. `INSERT OR REPLACE`는 삭제 트리거를 발동시키지 않아 FTS 인덱스가 깨진다.
- 대량 삽입은 트랜잭션 한 번에 100~1000개씩 묶는다.
- `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`. 키 PRAGMA는 **반드시 다른 어떤 쿼리보다 먼저** 실행한다.
- 스키마 버전을 `meta`에 두고 간단한 마이그레이션 함수를 만든다.

---

## 5. 보안 설계 (전부 구현)

### 5.1 키 계층
```
마스터 키 (32바이트 랜덤)
  위치: systemd LoadCredential → $CREDENTIALS_DIRECTORY/master-key
        (개발 환경: MASTER_KEY 환경변수 base64 또는 MASTER_KEY_FILE)
  ├─ HKDF-SHA256("token-enc")        → 토큰 암호화 키 (AES-256-GCM)
  ├─ HKDF-SHA256("registry-db")      → registry.db SQLCipher 키
  └─ HKDF-SHA256("user-db:<userId>") → 사용자별 DB 키
```
- 토큰 암호문 형식: `v1:<iv b64>:<tag b64>:<ct b64>`. AAD에 `user_id`를 넣어 다른 사용자 행으로 옮겨 붙이면 복호화가 실패하게 한다.
- 마스터 키는 DB, 코드 저장소, 로그 어디에도 두지 않는다. 키 파일 권한은 `600`, 소유자는 root. systemd가 서비스에만 전달한다.

### 5.2 토큰 입력과 검증
- 토큰은 **모달 입력창**으로만 받는다. 채팅 입력이나 명령어 옵션으로는 절대 받지 않는다(기록에 남는다).
- 받은 즉시 `GET /users/@me`를 호출해 **응답 `id`가 `interaction.user.id`와 같은지** 확인한다. 다르면 거부하고 저장하지 않는다.
- 봇 토큰 형식(`Bot ` 접두사 등)이나 명백히 잘못된 문자열은 사전에 거부한다.

### 5.3 토큰 사용 범위 제한 (`userApi.ts`)
- **허용하는 요청은 딱 3가지, 전부 GET이다.**
  - `GET /users/@me`
  - `GET /users/@me/channels`
  - `GET /channels/{snowflake}/messages` (쿼리: `limit`, `before`, `after`만 허용)
- 그 외 메서드나 경로는 요청 전에 예외를 던진다. **메시지 전송, 수정, 삭제, 친구, 설정 관련 코드는 존재하지 않게 한다.** 테스트로 이를 보장한다(§10).
- 베이스 URL은 `https://discord.com/api/v9`로 고정한다.

### 5.4 접근 통제
- `ALLOWED_USER_IDS`(쉼표 구분)에 없는 사용자는 모든 명령에서 거부한다: "그거는 초대된 사람만 쓸 수 있어요."
- 검색은 **요청자 본인의 DB만** 연다. 다른 사용자의 DB를 여는 코드 경로가 없어야 한다.
- 모든 응답은 ephemeral이다. `allowed_mentions: { parse: [] }`로 멘션 알림이 가지 않게 한다.
- 페이지 버튼이나 셀렉트를 누른 사람이 세션 소유자인지 확인한다.

### 5.5 수명 관리
- `/연동해제`: 확인 버튼을 누르면 registry 행, 사용자 DB 파일(`-wal`, `-shm` 포함), 메모리 세션을 **즉시 전부 삭제**한다.
- 동기화 중 `401`이 오면(비밀번호 변경 등) 토큰을 즉시 `NULL`로 만들고 `status='token_invalid'`로 바꾼다. 다음 명령에서 "다시 연동해 주세요"를 안내한다. 이미 모은 메시지는 검색 가능하게 유지한다.
- `403`, `404`가 나는 채널은 건너뛰고 기록만 남긴다.

### 5.6 서버와 로그
- 인바운드는 SSH(22)만 허용한다. Oracle 보안 목록과 `ufw` 양쪽에서 막는다. SSH는 키 인증만, 비밀번호 로그인은 끈다.
- `unattended-upgrades`로 보안 업데이트를 자동 설치한다.
- systemd 격리: `User=geugeo`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `ReadWritePaths=/var/lib/geugeo`.
- 로거는 토큰 패턴(`[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}`)과 `content`, `search_text` 필드를 자동으로 마스킹한다. 에러 객체를 그대로 찍지 말고 필요한 필드만 남긴다.

### 5.7 남는 위험 (사용자에게 README와 `/연동` 안내에서 고지)
- 서버가 실행 중인 상태로 완전히 탈취되면 메모리의 키로 토큰이 노출될 수 있다.
- 계정 토큰 사용은 디스코드 약관 위반이며, 계정 정지 가능성이 0은 아니다.

---

## 6. 동기화

### 6.1 계정 토큰 REST 클라이언트
- 헤더: `Authorization: <token>`(접두사 없음). User-Agent는 일반 브라우저 문자열을 쓴다.
- **속도:** 요청 사이에 기본 1200ms에 무작위 0~600ms를 더해 쉰다(`USER_API_DELAY_MS`). 요청은 **전역에서 한 번에 하나**만 보낸다(여러 사용자라도 직렬 처리).
- **429:** 응답의 `retry_after`(초)만큼 기다린 뒤 재시도한다. `global: true`면 전체 큐를 멈춘다. 5회 연속 실패하면 해당 작업을 `error`로 표시한다.
- `X-RateLimit-Remaining`이 0이면 `X-RateLimit-Reset-After`만큼 선제적으로 기다린다.
- 네트워크 오류와 5xx는 지수 백오프로 재시도한다(최대 5회).

### 6.2 알고리즘
**채널 목록:** `GET /users/@me/channels`에서 `type === 1`만 남기고 `channels`에 upsert한다. 상대 이름은 `recipients[0].global_name ?? username`을 쓴다.

**전체 백필(채널마다, 재개 가능):**
```
before = channel.oldest_synced_id ?? undefined
loop:
  page = GET /channels/{id}/messages?limit=100&before={before}
  if page 비었음: backfill_done = 1; break
  정규화 → 트랜잭션 upsert
  before = page 중 가장 작은 ID
  oldest_synced_id = before;  newest_synced_id = max(기존, page 최대 ID)
  진행률 갱신
```
**증분:** `after = newest_synced_id`로 새 메시지가 없을 때까지 반복한다. **응답 순서에 의존하지 말고** 매번 ID(BigInt)로 정렬해서 처리한다.

**언제 도는가**
- `/연동`은 토큰만 저장한다. DM 목록을 데이터베이스에 넣지 않는다.
- `/수집`: 명령어를 입력한 1:1 DM 하나만 찾아 그 채널만 백필한다. 다른 DM은 저장하지 않는다.
- 주기(`SYNC_INTERVAL_MIN`, 기본 30분): 수집해 둔 채널만 `last_message_id != newest_synced_id`일 때 증분 동기화한다.
- `/검색` 직전: 이미 수집한 현재 DM만 최대 2초 동안 증분 동기화를 시도한다. 수집하지 않은 DM은 가져오지 않고 `/수집`을 안내한다.
- `/동기화`: 수집해 둔 대화만 수동 증분 동기화한다. `전체`는 그 대화들의 과거만 다시 모은다.
- 프로세스가 재시작되면 수집 표시가 있고 `backfill_done = 0`인 채널만 이어서 한다.

**한계 (README에 명시):** 증분 동기화는 과거 메시지의 수정과 삭제를 반영하지 못한다. `/동기화 전체:true`는 수집해 둔 대화만 다시 모은다.

### 6.3 정규화 (`normalize.ts`)
- 저장 대상 메시지 타입: `0`(일반), `19`(답장). 나머지 시스템 메시지(통화, 고정 알림 등)는 건너뛴다.
- `search_text`는 아래를 공백과 줄바꿈으로 이어 붙인다. **이것이 "youtube로 검색하면 다 나오게" 만드는 핵심이다.**
  1. `content`
  2. 첨부파일 `filename`
  3. 임베드 `title`, `description`, `url`, `provider.name`, `author.name`, 필드 `name`과 `value` (유튜브 링크면 영상 제목과 채널명이 들어온다)
  4. 스티커 이름
  5. 전달(forward)된 메시지의 `message_snapshots[].message.content`
- 플래그:
  - `has_link`: 본문이나 임베드에 `https?://`가 있음
  - `has_youtube`: `youtube.com`, `youtu.be`, `music.youtube.com`
  - `has_image`: 이미지 첨부(`content_type` 이미지 계열 또는 확장자)나 이미지 임베드
  - `has_file`: 이미지가 아닌 첨부

---

## 7. 검색

### 7.1 쿼리 전략 (`query.ts`)
- 검색어는 앞뒤 공백을 자르고 1~100자로 제한한다. **공백으로 나뉜 여러 단어는 AND**로 처리한다(각 단어가 모두 포함된 메시지).
- 각 단어마다 경로를 고른다.
  - **3글자 이상:** `messages_fts MATCH '"<단어>"'` (큰따옴표는 두 번 써서 이스케이프)
  - **3글자 미만:** `search_text LIKE '%<단어>%' ESCAPE '\'` (`%`, `_`, `\` 이스케이프)
  - 여러 단어면 FTS 조건과 LIKE 조건을 AND로 결합한다.
- 대소문자는 구분하지 않는다. trigram 기본값과 LIKE 모두 ASCII는 대소문자를 무시한다.
- 필터 SQL:
  - 범위: DM 안에서 호출하면 `channel_id = interaction.channelId`, 그 외에는 요청자의 모든 DM
  - 보낸 사람: `나`는 `author_id = 요청자`, `상대`는 `author_id != 요청자`
  - 종류: `링크`, `유튜브`, `이미지`, `파일` 플래그
  - 기간: `ts >= now - N`
- 정렬: 최신순(`ts DESC`). 총 개수는 `COUNT(*)`로 따로 구한다.
- 페이지 크기는 **5개**다(Components V2 제약, §8.3).
- 성능 목표: 메시지 10만 개 기준 FTS 경로 100ms 이하, LIKE 경로 300ms 이하.

### 7.2 발췌와 하이라이트 (`snippet.ts`)
- 첫 매치를 중심으로 앞뒤 합쳐 약 160자를 잘라낸다. 잘린 쪽에 `…`를 붙인다. 매치가 본문이 아닌 임베드나 첨부 이름에서 났으면 그 텍스트를 발췌하고 앞에 출처(`🔗`, `📎`)를 붙인다.
- 순서: ① 발췌 → ② 디스코드 마크다운 이스케이프(discord.js `escapeMarkdown`) → ③ 매치 부분을 `**굵게**`
- **URL 안에는 마크다운을 넣지 않는다**(링크가 깨진다). URL 토큰은 `<https://...>` 형태로 출력하고, 매치가 URL 안에 있으면 URL 전체를 굵게 하지 말고 그대로 둔다. 길면 가운데를 `…`로 줄이되, 그 경우 링크 대신 인라인 코드로 보여준다.
- 여러 줄은 최대 3줄로 줄인다.

---

## 8. 명령어와 UI

### 8.1 명령어 정의 (`commands.ts`)
모든 명령어 공통:
```ts
integration_types: [ApplicationIntegrationType.UserInstall]
contexts: [InteractionContextType.BotDM, InteractionContextType.PrivateChannel, InteractionContextType.Guild]
```
기본 이름은 영어 소문자로 하고, `name_localizations: { ko: '검색' }`처럼 한국어를 붙인다(한국어 클라이언트에서는 `/검색`으로 보이고 입력할 수 있다). 설명도 `description_localizations.ko`를 쓴다.

| 이름(ko) | 옵션 | 동작 |
|---|---|---|
| `search`(그거) | `검색어`(필수, 1~100자), `보낸사람`(전체/나/상대), `종류`(전체/링크/유튜브/이미지/파일), `기간`(전체/7일/30일/1년) | 지금 보고 있는 1:1 DM만 검색 |
| `recall`(그거뭐지) | `search`와 같음 | 수집해 둔 DM 전체 검색 |
| `ai-search`(ai검색) | `질문`(필수), `상대`(자동완성) | AI 의미 검색 (베타) |
| `link`(연동) | 없음 | 토큰만 저장. 메시지는 가져오지 않음 |
| `collect`(수집) | 없음 | 지금 열린 1:1 DM만 모음 |
| `collect-all`(전체수집) | 없음 | 1:1 DM 전체를 모음. 그룹 대화와 서버 채널은 제외 |
| `stop`(중지) | 없음 | 진행 중인 수집을 멈춤. 받은 메시지는 유지 |
| `reset`(초기화) | 없음 | 확인 후 모아 둔 메시지 전부 삭제. 연동은 유지 |
| `unlink`(연동해제) | 없음 | 확인 버튼 → 토큰과 데이터 완전 삭제 |
| `status`(상태) | 없음 | 연동 상태, 동기화 진행률, 채널과 메시지 수 |
| `sync`(동기화) | `전체`(boolean) | 수집해 둔 대화만 수동 동기화 |

- `상대` 자동완성: 수집해 둔 채널에서 `recipient_name LIKE`로 최대 25개를 보여준다. 값은 채널 ID다.
- 커맨드 등록은 `npm run register`(글로벌)로 한다. 유저 설치형 앱은 길드 커맨드를 쓸 수 없으므로 개발 중에도 글로벌 커맨드로 등록한다(보통 몇 분 안에 반영되고, 디스코드 앱을 `Ctrl/Cmd+R`로 새로고침하면 바로 보인다).

### 8.2 디스코드 스타일 (`ui/theme.ts`)
- 강조색: Blurple `#5865F2`. 에러 `#ED4245`, 성공 `#57F287`, 경고 `#FEE75C`.
- 시간은 반드시 `<t:unix초:f>`를 쓴다. 보는 사람의 언어와 시간대로 자동 표시돼서 디스코드 검색 결과와 같은 형식이 된다.
- 문구는 짧은 존댓말로 쓴다("~했어요", "~해 주세요").
- 이모지는 최소한만 쓴다: 🔍 검색, 🔗 링크, 📎 파일, 🖼️ 이미지, ✨ AI 베타.

### 8.3 검색 결과 레이아웃 (Components V2, `flags: IsComponentsV2 | Ephemeral`)
```
Container (accent #5865F2)
├─ TextDisplay   "### 🔍 youtube\n민수님과의 DM · 결과 312개"
├─ Separator
├─ Section ─ TextDisplay "**민수** · <t:1710224460:f>\n이거 봐바 <https://www.youtube.com/watch?v=...>\n🔗 **YouTube** · 아이유 - 밤편지 (Live)"
│         └─ accessory: Button(Link) "이동" → https://discord.com/channels/@me/{channel}/{message}
├─ Separator (divider: false, 작은 간격)
├─ Section ... (×5)
├─ Separator
├─ TextDisplay   "-# 1 / 63 페이지 · 최신순"
ActionRow: [◀ 이전] [다음 ▶]                        (첫/끝 페이지면 disabled)
ActionRow: StringSelect 보낸 사람 (전체 / 나 / 민수)
ActionRow: StringSelect 종류 (전체 / 링크 / 유튜브 / 이미지 / 파일)
```
- DM 밖에서 전체 DM을 검색하면 각 결과 첫 줄에 `민수와의 DM` 같은 채널 이름을 붙인다.
- **제약:** 메시지당 컴포넌트는 최대 40개(중첩 포함)이고, TextDisplay 전체 글자 수는 4000자다. 빌더는 추가 전에 합계를 세서 넘으면 발췌를 더 줄인다. 테스트로 보장한다.
- "이동" 링크를 누르면 디스코드가 해당 메시지로 바로 이동한다.

### 8.4 세션과 페이지네이션 (`sessions.ts`)
- `Map<sid, {ownerId, scope, query, filters, total, createdAt}>`, TTL 15분. `sid`는 8자 랜덤이다.
- `custom_id` 형식은 `gg:page:<sid>:<n>`, `gg:filter:author:<sid>`, `gg:filter:kind:<sid>`다(100자 제한).
- 버튼이나 셀렉트 입력은 `interaction.update()`로 같은 메시지를 교체한다(새 메시지를 만들지 않는다).
- 세션이 만료됐으면 "검색이 만료됐어요. `/검색`을 다시 입력해 주세요."를 보여준다.

### 8.5 상태별 화면 (`ui/states.ts`)
| 상황 | 화면 |
|---|---|
| 허용 목록에 없음 | "그거는 초대된 사람만 쓸 수 있어요." |
| 미연동 | 한 줄 설명과 **[연동하기]** 버튼 (누르면 `/연동`과 같은 흐름) |
| 동기화 중 | 결과 위에 경고색 줄: "-# ⏳ 아직 모으는 중이에요 (12개 중 4번째 대화, 48,211개). 지금까지 모은 메시지에서 찾았어요." |
| 결과 없음 | "‘youtube’가 들어간 메시지가 없어요." + 팁(필터 해제, 기간 늘리기, `/동기화`) |
| 이 DM이 아직 없음 | "이 대화는 아직 안 모였어요. 잠시 후 다시 시도해 주세요." (백그라운드에서 채널 목록 갱신 시작) |
| 토큰 만료 | "토큰이 만료됐어요(비밀번호 변경 등). `/연동`으로 다시 연결해 주세요. 이미 모은 메시지는 계속 검색돼요." |
| 내부 에러 | "문제가 생겼어요. 잠시 후 다시 시도해 주세요." (상세 내용은 로그로만) |

- 3초 안에 응답하지 못할 수 있는 명령은 모두 먼저 `deferReply({ flags: Ephemeral })`한 뒤 `editReply`한다.

### 8.6 `/연동` 흐름 (`handlers/link.ts`)
1. ephemeral 안내를 띄운다. 무엇을 하는지, 위험 고지(§5.7), 토큰 찾는 법을 보여주고 **[토큰 입력하기]** 버튼을 둔다.
   - 토큰 찾는 법(브라우저 기준): discord.com/app 로그인 → `F12` → Network 탭 → 필터에 `api` 입력 → 아무 요청 클릭 → Request Headers의 `authorization` 값 복사.
   - "이 값은 비밀번호와 같아요. 그거 말고는 아무 데도 붙여넣지 마세요."
   - 콘솔에 코드를 붙여넣는 방법은 안내하지 않는다(셀프 XSS 사기와 구분이 안 된다).
2. 버튼을 누르면 모달을 연다. `LabelBuilder`와 TextInput(Short, 50~100자)을 쓴다.
3. 제출하면 `deferReply` → 검증(§5.2) → 암호화 저장 → 백필 큐에 등록 → "연결됐어요! 대화를 모으는 중이에요"를 보여준다.
4. 첫 15분 동안 약 10초마다 `editReply`로 진행률을 갱신한다(Interaction 토큰 유효시간이 15분). 그 뒤로는 `/상태`로 확인한다.
5. 이미 연동된 사용자가 다시 하면 토큰만 교체하고 기존 데이터는 유지한다.

---

## 9. AI 검색 베타 (`search/semantic.ts`)

- 모델: `Xenova/multilingual-e5-small`(한국어 지원, 384차원, q8 양자화). `@huggingface/transformers`의 `pipeline('feature-extraction', ..., { dtype: 'q8' })`를 쓰고 `pooling: 'mean', normalize: true`로 뽑는다.
- 접두사: 저장 문서는 `"passage: "`, 질문은 `"query: "`를 붙인다(e5 규칙).
- 대상: `search_text` 기준 4자 이상 메시지. 링크만 있는 메시지는 임베드 제목이 있으면 포함한다.
- 생성 시점: 백필과 증분 뒤 백그라운드에서 32개씩 배치로 만든다. 동기화보다 우선순위를 낮게 두고, 사용자별 진행률을 `/상태`에 보여준다.
- 검색: 범위 안 임베딩 전체와 내적(정규화했으므로 코사인)을 구해 상위 20개를 뽑는다. 10만 개×384차원은 브루트포스로도 충분하다. 사용자별 LRU 메모리 캐시(최대 2명)를 둔다.
- 결과 UI는 §8.3과 같고, 헤더에 `✨ AI 검색 (베타)`를 붙이고 하이라이트는 하지 않는다. 결과 하단에 "-# 정확하지 않을 수 있어요. 정확한 단어를 알면 /검색이 더 확실해요."를 표시한다.
- 모델 캐시는 `DATA_DIR/.cache`에 둔다. `AI_ENABLED=false`면 명령어가 "지금은 꺼져 있어요"를 반환한다.
- **확인 필요한 위험:** linux-arm64에서 `onnxruntime-node`가 동작하는지 Oracle 서버에서 가장 먼저 확인한다. 안 되면 AI를 끄고 나머지 기능을 출시한다.

---

## 10. 테스트 (vitest, `test/`)

외부 네트워크 없이 전부 돌아가야 한다. `fetch`는 모의 객체로 대체한다.

| 영역 | 반드시 있어야 하는 테스트 |
|---|---|
| crypto | 암복호화 왕복 / 변조된 암호문 거부 / AAD가 다른 user_id면 실패 / HKDF 라벨이 다르면 키가 다름 |
| userStore | 잘못된 키로 열면 실패 / upsert 후 FTS 갱신(수정 시 옛 단어로는 안 잡히고 새 단어로 잡힘) / 삭제 시 FTS 제거 |
| search | URL 안 `youtube` 검색 / 2글자 한국어 `회의`로 `회의록이야` 검색 / 1글자 검색 / 대소문자 무시(`YouTube`) / 여러 단어 AND / `%`, `_`, `"` 특수문자 / 보낸 사람, 종류, 기간 필터 / 페이지와 총 개수 / 임베드 제목으로 검색 / 첨부 파일명으로 검색 |
| normalize | 시스템 메시지 제외 / 플래그 판정 / 전달 메시지 포함 |
| userApi | 허용 목록 밖(POST, 다른 경로, 허용 안 된 쿼리)은 요청 전에 예외 / 429 `retry_after` 준수 / 401이면 `TokenInvalidError` |
| syncer | 백필이 중간에 끊겨도 `oldest_synced_id`부터 재개 / 증분이 응답 순서와 무관하게 동작 / 401이면 토큰 폐기 |
| snippet | 마크다운 이스케이프 / URL 안에 `**` 없음 / 길이 제한 |
| ui | 결과 5개 + 필터일 때 컴포넌트 40개 이하, 텍스트 4000자 이하 / 긴 메시지 5개에서도 제한 준수 |
| guard | 허용 목록에 없는 사용자 거부 |

`npm run demo`: 임시 DB에 가짜 DM 2개와 메시지 수천 개(유튜브 링크, 한국어, 이모지, 임베드 포함)를 넣고 터미널에서 검색어를 입력받아 결과를 출력한다. 디스코드 없이 검색 품질을 눈으로 확인하는 용도다.

---

## 11. 설정 (`.env.example`)

```
DISCORD_BOT_TOKEN=          # 개발자 포털 > Bot > Reset Token
DISCORD_APP_ID=             # 개발자 포털 > General Information > Application ID
ALLOWED_USER_IDS=           # 쉼표 구분 디스코드 사용자 ID (운영자 포함)
MASTER_KEY=                 # 개발용만. npm run gen-key 출력(base64 32바이트). 운영은 systemd credential
MASTER_KEY_FILE=            # 선택: 키 파일 경로
DATA_DIR=./data
AI_ENABLED=true
SYNC_INTERVAL_MIN=30
USER_API_DELAY_MS=1200
LOG_LEVEL=info
```
`config.ts`는 필수 값이 없으면 어떤 값이 빠졌는지 한국어로 알려주고 종료한다. 마스터 키 우선순위는 `$CREDENTIALS_DIRECTORY/master-key` → `MASTER_KEY_FILE` → `MASTER_KEY`다.

`.env` 로드는 Node 22 내장 `process.loadEnvFile()`을 쓴다(파일이 있을 때만).

---

## 12. 배포

### 12.1 디스코드 개발자 포털 (README에 스크린샷 없이 단계로)
1. https://discord.com/developers/applications → **New Application** → 이름 `그거`.
2. **General Information**: Application ID 복사 → `DISCORD_APP_ID`. 아이콘 업로드.
3. **Bot**: **Reset Token** → `DISCORD_BOT_TOKEN`. Privileged Intents는 **전부 끈 상태로 둔다**(필요 없음). "Public Bot"은 켜둬도 되지만 허용 목록이 보호한다.
4. **Installation**: Installation Contexts에서 **User Install만 체크**한다(Guild Install 해제). Install Link는 "Discord Provided Link", User Install 스코프는 `applications.commands`.
5. 서버에서 `npm run register`.
6. Installation 페이지의 설치 링크를 친구들에게 공유 → 친구는 "내 앱에 추가" → DM에서 `/연동`.
7. 친구 ID는 디스코드 설정 → 고급 → 개발자 모드 → 프로필 우클릭 → "사용자 ID 복사". 운영자가 `ALLOWED_USER_IDS`에 추가하고 재시작한다.

### 12.2 Oracle Cloud Always Free
1. 가입(카드 인증 필요, 과금 없음). 홈 리전은 **나중에 바꿀 수 없다.** 춘천이나 서울이 무료 ARM 자리가 없으면 도쿄나 오사카도 괜찮다.
2. Compute → Instance 생성: 이미지 **Ubuntu 24.04**, Shape **VM.Standard.A1.Flex (Ampere) 2 OCPU / 12GB**(무료 한도 4 OCPU / 24GB 안), 부트 볼륨 100GB, SSH 공개키 등록.
   - "Out of capacity"가 나오면 시간을 두고 재시도한다.
3. VCN 보안 목록: 인바운드는 22/tcp만 남긴다(기본값 그대로 두면 된다). 80, 443을 **열지 않는다.**
4. `deploy/setup-oracle.sh` (root로 실행, 멱등):
   - `apt update && apt upgrade`, `unattended-upgrades`, `ufw`(22만 허용), `fail2ban`
   - Node 22 설치(NodeSource), `build-essential`(네이티브 모듈 빌드용)
   - 시스템 사용자 `geugeo`, `/opt/geugeo`(코드), `/var/lib/geugeo`(데이터, 700)
   - `/etc/geugeo/master-key`가 없으면 `openssl rand -base64 32`로 생성(600, root)
   - `/etc/geugeo/geugeo.env`(600)에 봇 토큰 등 설정
   - 코드 배치 → `npm ci && npm run build` → `npm run register`
   - `deploy/geugeo.service` 설치 → `systemctl enable --now geugeo`
5. `deploy/geugeo.service` 요점:
   ```ini
   [Service]
   User=geugeo
   WorkingDirectory=/opt/geugeo
   EnvironmentFile=/etc/geugeo/geugeo.env
   Environment=DATA_DIR=/var/lib/geugeo NODE_ENV=production
   LoadCredential=master-key:/etc/geugeo/master-key
   ExecStart=/usr/bin/node dist/index.js
   Restart=on-failure
   NoNewPrivileges=yes
   ProtectSystem=strict
   ProtectHome=yes
   PrivateTmp=yes
   ReadWritePaths=/var/lib/geugeo
   ```
6. 업데이트: `git pull && npm ci && npm run build && systemctl restart geugeo`. README에 적는다.
7. **유휴 회수 주의:** Oracle은 7일 동안 CPU, 네트워크, 메모리 사용률이 모두 낮은 Always Free 인스턴스를 회수할 수 있다. 이 봇은 대부분 유휴 상태라 대상이 될 수 있다. 계정을 Pay As You Go로 업그레이드하면 회수 대상에서 빠지고, 무료 한도 안에서는 과금되지 않는다. 업그레이드할 경우 예산 알림(Budgets, 1달러)을 반드시 설정하도록 README에 안내한다.
8. **마스터 키를 잃어버리면 모든 데이터를 복구할 수 없다.** 운영자가 안전한 곳(비밀번호 관리자)에 따로 보관하도록 README에 강조한다.

---

## 13. 마일스톤

각 단계는 **완료 기준을 통과해야** 다음으로 넘어간다. 단계마다 커밋하고 푸시한다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **M1 저장소와 검색** | `config`, `crypto`, `registry`, `userStore`, `normalize`, `query`, `snippet`, `demo` | §10의 crypto, userStore, search, normalize, snippet 테스트 통과. `npm run demo`에서 `youtube`, `회의`가 기대대로 나옴 |
| **M2 수집** | `userApi`, `queue`, `syncer`, `scheduler` | 모의 fetch로 userApi, syncer 테스트 통과. 백필 재개와 401 처리 확인 |
| **M3 봇과 UI** | `client`, `commands`, `guard`, `sessions`, 모든 handler, `ui/*`, `registerCommands` | ui, guard 테스트 통과. `npm run typecheck` 통과. 실제 봇 토큰으로 운영자 DM에서 `/검색`, 페이지 넘김, 필터가 동작 |
| **M4 보안 점검** | §5 체크리스트 전부, 로거 마스킹 | 체크리스트를 README "보안" 절에 표로 남기고 전부 ✅ |
| **M5 AI 베타** | `semantic.ts`, `/ai검색`, 백그라운드 임베딩 | 데모 데이터에서 "노래 추천"으로 음악 관련 메시지가 상위에 나옴. 끄면 깔끔하게 비활성 |
| **M6 배포** | `deploy/*`, README 완성 | 새 Ubuntu 24.04 ARM에서 스크립트 한 번으로 서비스가 뜸 |
| **M7 친구 베타** | 운영자와 친구 1~2명 실사용 | 실제 DM에서 기존 디스코드 검색이 못 찾던 링크를 찾음 |

---

## 14. 구현 원칙

- TypeScript strict, ESM. `any` 금지(외부 API 응답은 최소 타입을 정의하고 필요한 필드만 쓴다).
- 사용자에게 보이는 문구는 전부 한국어이고 `ui/theme.ts`나 `ui/states.ts`에 모은다.
- 새 의존성은 꼭 필요할 때만 추가한다. 로거는 직접 작성한다(얇게).
- 동기 SQLite(better-sqlite3)를 쓰되, 큰 쿼리가 이벤트 루프를 오래 막지 않게 페이지 단위로 처리한다.
- 문서에 없는 판단은 **①보안 ②사용자가 헤매지 않음 ③단순함** 순서로 결정한다.
- 불확실한 디스코드 API 동작(예: 유저 설치형 앱의 DM interaction 필드)은 추측하지 말고 실제 DM에서 확인한 뒤 코드와 README에 반영한다.

---

## 15. 운영자가 준비할 것

| 항목 | 언제 | 비고 |
|---|---|---|
| 디스코드 앱 (봇 토큰, App ID) | M3 시작 전 | §12.1 |
| 본인과 친구들의 디스코드 사용자 ID | M3 | 허용 목록 |
| Oracle Cloud 계정 | M6 시작 전 | §12.2 |

봇 토큰, App ID, 허용 목록은 Cursor 대시보드의 Cloud Agents → Secrets에 `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `ALLOWED_USER_IDS` 이름으로 등록된다. 구현자는 이 값을 환경변수로 읽는다. 채팅에 봇 토큰을 쓰게 하지 않는다.
