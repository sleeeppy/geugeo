export const COLOR = {
  blurple: 0x5865f2,
  red: 0xed4245,
  green: 0x57f287,
  yellow: 0xfee75c,
} as const;

export const COPY = {
  denied: '그거는 초대된 사람만 쓸 수 있어요.',
  notLinked: 'DM을 검색하려면 계정 토큰을 한 번 연결해야 해요.',
  linkButton: '연동하기',
  tokenButton: '토큰 입력하기',
  empty: (query: string) => `‘${query}’가 들어간 메시지가 없어요.`,
  emptyHint: '필터를 전체로 바꾸거나 기간을 늘려 보세요. 방금 보낸 메시지면 `/동기화`를 눌러 주세요.',
  channelMissing: '이 대화는 아직 안 모았어요. 그 사람과의 DM에서 `/수집`을 입력하세요.',
  searchHereOnly: '이 명령은 지금 보고 있는 1:1 DM만 검색해요. 그 사람과의 대화창에서 `/그거`를 입력하거나, 모아 둔 전체를 보려면 `/그거뭐지`를 쓰세요.',
  tokenExpired: '토큰이 만료됐어요(비밀번호 변경 등). `/연동`으로 다시 연결해 주세요. 이미 모은 메시지는 계속 검색돼요.',
  internalError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  sessionExpired: '검색이 만료됐어요. `/그거`를 다시 입력해 주세요.',
  aiOff: 'AI 검색은 지금은 꺼져 있어요.',
  aiFoot: '정확하지 않을 수 있어요. 정확한 단어를 알면 /그거가 더 확실해요.',
  linked: '연결됐어요. 메시지를 모으려면 그 사람과의 DM을 열고 `/수집`을 입력하세요.',
  notDm: '지금 열린 창이 1:1 DM이 아니에요. 그 사람과의 대화창에서 `/수집`을 입력하세요.',
  notBotDm: '봇과의 대화는 수집하지 않아요. 그 사람과의 DM에서 `/수집`을 입력하세요.',
  collecting: (name: string) => `${name}와의 DM을 모으는 중이에요.`,
  collected: (name: string, count: number) => `${name}와의 DM을 모았어요. 메시지 ${count.toLocaleString('ko-KR')}개.`,
  collectAllAsk:
    '범위를 고르면 그때 모으기 시작해요.\n-# **DM만**은 1:1 대화만, **서버까지**는 그 DM과 읽을 수 있는 서버 글 채널을 같이 모아요.',
  collectingAll: (scope: string, done: number, total: number, messages: number) =>
    `${scope} 범위를 모으는 중이에요.\n-# ${formatProgress(done, total, messages)}`,
  collectedAll: (scope: string, total: number, messages: number) =>
    `${scope} 범위 ${total.toLocaleString('ko-KR')}개를 모았어요. 메시지 ${messages.toLocaleString('ko-KR')}개.`,
  noDms: '모을 대화가 없어요.',
  alreadySyncing: '이미 모으는 중이에요. `/상태`에 사람별 개수가 나와요.',
  stopped: '수집을 멈췄어요. 지금까지 받은 메시지는 그대로 검색돼요.',
  stopIdle: '지금 모으는 대화가 없어요.',
  resetAsk: '모아 둔 DM 메시지를 전부 삭제할까요? 계정 연동은 유지돼요.',
  resetDone: (count: number) => `메시지 ${count.toLocaleString('ko-KR')}개를 삭제했어요. 연동은 그대로예요.`,
  resetEmpty: '모아 둔 메시지가 없어요.',
  unlinked: '연동을 해제하고 이 서버에 있던 대화를 삭제했어요.',
  unlinkAsk: '연동을 해제하면 토큰과 모아 둔 대화가 바로 삭제돼요. 계속할까요?',
  unlinkConfirm: '삭제하기',
  notLinkedYet: '아직 연동되지 않았어요. `/연동`으로 연결해 주세요.',
  syncStarted: '동기화를 시작했어요. `/상태`에서 진행을 볼 수 있어요.',
  risk: '계정 토큰으로 대화를 읽는 것은 디스코드 약관에 어긋날 수 있고, 계정 정지로 이어질 수 있어요. 서버가 실행 중인 채로 완전히 탈취되면 토큰이 노출될 수도 있어요.',
  tokenHelp:
    '브라우저에서 discord.com/app 에 로그인한 뒤 F12 → Network → 필터에 api 입력 → 아무 요청 → Request Headers의 authorization 값을 복사하세요. 이 값은 비밀번호와 같아요. 그거 말고는 아무 데도 붙여넣지 마세요.',
} as const;

export function formatProgress(done: number, total: number, messages: number): string {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const place = total === 0 ? 0 : Math.min(total, done < total ? done + 1 : done);
  return `${percent}% · ${place.toLocaleString('ko-KR')}/${total.toLocaleString('ko-KR')}번째 대화 · 메시지 ${messages.toLocaleString('ko-KR')}개`;
}

export type PersonState = 'active' | 'waiting' | 'done';

export interface PersonProgress {
  name: string;
  count: number;
  state: PersonState;
}

export function formatPersonProgress(name: string, count: number, state: PersonState): string {
  const amount = `${count.toLocaleString('ko-KR')}개`;
  if (state === 'done') return `${name} · 100% · ${amount}`;
  if (state === 'active') return `${name} · 수집 중 · ${amount}`;
  return `${name} · 대기 중 · ${amount}`;
}

export function renderPersonList(rows: PersonProgress[], limit = 20): string {
  const ordered = [...rows].sort((left, right) => personRank(left.state) - personRank(right.state) || left.name.localeCompare(right.name, 'ko'));
  const shown = ordered.slice(0, limit);
  const lines = shown.map((row, index) => `${index + 1}. ${formatPersonProgress(row.name, row.count, row.state)}`);
  const hidden = ordered.length - shown.length;
  if (hidden > 0) lines.push(`-# 외 ${hidden.toLocaleString('ko-KR')}개 대화`);
  return lines.join('\n');
}

function personRank(state: PersonState): number {
  if (state === 'active') return 0;
  if (state === 'waiting') return 1;
  return 2;
}
