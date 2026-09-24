# 그거

> "그때 보낸 **그거** 뭐였지?"

디스코드 1:1 DM을 검색하는 유저 설치형 봇입니다. 그 사람과의 DM에서 `/그거 youtube`를 입력하면 그 대화만 검색하고, 모아 둔 전체를 보려면 `/그거뭐지 youtube`를 씁니다. 링크 안의 단어, 두 글자 한국어, 유튜브 제목, 첨부 파일 이름도 찾습니다.

윈도우, 맥, 모바일 디스코드에서 같은 명령어로 씁니다. 따로 설치할 프로그램은 없습니다.

## 동작

1. 친구가 앱을 추가하고 `/연동`으로 계정 토큰을 한 번 넣습니다. 이 단계에서는 메시지를 가져오지 않습니다.
2. 수집할 사람과의 1:1 DM을 열고 `/수집`을 입력합니다. 그 대화의 양쪽 메시지만 읽기 전용으로 가져옵니다.
3. 대화는 사용자별 암호화 SQLite 파일에만 저장됩니다.
4. `/그거` 결과는 나에게만 보이고, **열기**를 누르면 그 메시지로 갑니다.
5. `/ai검색`은 서버 안의 무료 임베딩 모델로 의미를 찾습니다. 외부 AI로 대화를 보내지 않습니다.

증분 동기화는 이미 모은 메시지의 수정과 삭제를 반영하지 못합니다. `/동기화 전체:True`는 수집해 둔 대화만 다시 모읍니다.

## 개발

Node.js 22 이상이 필요합니다.

```bash
npm install
cp .env.example .env
npm run gen-key   # 출력값을 .env 의 MASTER_KEY 에 넣기
npm test
npm run demo      # 디스코드 없이 youtube, 회의 검색 확인
npm run typecheck
npm run dev       # 봇 실행
npm run register  # 슬래시 명령어 등록
```

`.env`에 `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `ALLOWED_USER_IDS`가 있어야 봇이 켜집니다.

## 디스코드 앱

1. https://discord.com/developers/applications 에서 **New Application**, 이름 `그거`.
2. **General Information**의 Application ID를 `DISCORD_APP_ID`로 둡니다.
3. **Bot → Reset Token** 값을 `DISCORD_BOT_TOKEN`으로 둡니다. Privileged Gateway Intents는 전부 끈 채로 둡니다. Public Bot은 켜 둡니다.
4. **Installation**에서 **User Install만** 켜고 Guild Install은 끕니다. Install Link는 Discord Provided Link, User Install 스코프는 `applications.commands`.
5. 서버에서 `npm run register`.
6. 설치 링크를 친구에게 보냅니다. 친구는 **내 앱에 추가** 후 DM에서 `/연동`.
7. 친구의 사용자 ID(설정 → 고급 → 개발자 모드 → 프로필 우클릭 → 사용자 ID 복사)를 `ALLOWED_USER_IDS`에 쉼표로 넣고 서비스를 다시 시작합니다.

토큰은 모달에만 입력합니다. 채팅이나 명령어 옵션에 붙여 넣지 마세요.

## 서버

Oracle Cloud Always Free, Ubuntu 24.04입니다. 들어오는 포트는 SSH 22만 엽니다. 웹 포트는 열지 않습니다. 봇이 디스코드에 먼저 접속합니다.

계정은 Pay As You Go로 두는 편이 안전합니다. ARM 1 OCPU / 6GB / 디스크 60GB는 무료 한도 안입니다. **Billing → Budgets**에서 1달러 알림을 켜 두세요. 무료 한도를 넘기거나 유료 자원을 만들면 그 부분만 과금됩니다.

7일 동안 거의 안 쓰인 무료 서버는 Oracle이 회수할 수 있습니다. Pay As You Go로 올리면 회수 대상에서 빠지고, 무료 한도 안에서는 요금이 나가지 않습니다.

```bash
ssh ubuntu@공인IP
sudo mkdir -p /opt/geugeo
sudo chown "$USER" /opt/geugeo
git clone https://github.com/sleeeppy/geugeo.git /opt/geugeo
sudo bash /opt/geugeo/deploy/setup-oracle.sh
```

처음 실행하면 `/etc/geugeo/geugeo.env`가 생깁니다. 봇 토큰, 앱 ID, 허용 ID를 채운 뒤 스크립트를 한 번 더 실행하세요. `/etc/geugeo/master-key`는 그때 한 번만 만들어집니다. **비밀번호 관리자에 복사해 두세요. 이 키를 잃으면 저장된 대화는 복구할 수 없습니다.**

업데이트:

```bash
cd /opt/geugeo && git pull && sudo bash deploy/setup-oracle.sh
```

로그는 `journalctl -u geugeo -f` 입니다.

비공개 저장소면 서버에 배포 키를 두거나, 압축해서 `/opt/geugeo`로 복사한 뒤 같은 스크립트를 실행하면 됩니다.

## 보안

| 항목 | 상태 |
|---|---|
| 마스터 키는 DB, 코드, 로그와 분리 (systemd credential) | ✅ |
| 토큰은 AES-256-GCM, 사용자 ID를 추가 인증 데이터로 사용 | ✅ |
| 사용자별 SQLCipher 데이터베이스 | ✅ |
| 토큰은 모달로만 받고, `/users/@me` 결과 ID가 명령어를 친 사람과 같을 때만 저장 | ✅ |
| 계정 토큰으로 허용하는 요청은 `GET /users/@me`, `GET /users/@me/channels`, `GET /channels/{id}/messages` 뿐 | ✅ |
| 허용 목록에 없는 사용자는 모든 명령 거부 | ✅ |
| 검색 결과는 나에게만 보이고 멘션 알림을 만들지 않음 | ✅ |
| `/연동해제`는 토큰, 데이터베이스, 검색 세션을 즉시 삭제 | ✅ |
| 401이면 토큰을 지우고 이미 모은 메시지만 검색 | ✅ |
| 로그에서 토큰 패턴과 메시지 본문을 가림 | ✅ |
| 인바운드는 SSH만, 비밀번호 로그인 비활성, 자동 보안 업데이트, systemd 격리 | ✅ |

남는 위험은 두 가지입니다.

- 서버가 실행 중인 상태로 완전히 탈취되면 메모리의 키로 토큰을 읽을 수 있습니다.
- 계정 토큰으로 DM을 읽는 것은 디스코드 이용약관에 어긋나며, 계정 정지 가능성이 있습니다.

가까운 사람끼리, 이 위험을 이해한 상태에서만 쓰세요.

## 명령어

| 명령 | 하는 일 |
|---|---|
| `/그거` | 지금 보고 있는 1:1 DM에서 글자 검색 |
| `/그거뭐지` | 모아 둔 DM 전체에서 글자 검색 |
| `/ai검색` | 의미 검색 (베타). `AI_ENABLED=false`면 안내만 합니다 |
| `/연동` `/연동해제` | 토큰 연결, 데이터 삭제. 연동만으로는 메시지를 가져오지 않습니다 |
| `/수집` | 명령어를 입력한 1:1 DM만 모읍니다 |
| `/중지` | 진행 중인 수집을 멈춥니다. 이미 받은 메시지는 남습니다 |
| `/초기화` | 모아 둔 DM 메시지를 전부 삭제합니다. 연동은 유지됩니다 |
| `/상태` | 진행률, 대화 수, AI 임베딩 수 |
| `/동기화` | 수집해 둔 대화의 새 메시지. `전체`를 켜면 그 대화들의 과거를 다시 모읍니다 |
