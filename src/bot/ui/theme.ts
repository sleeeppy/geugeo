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
  channelMissing: '이 대화는 아직 안 모였어요. 잠시 후 다시 시도해 주세요.',
  tokenExpired: '토큰이 만료됐어요(비밀번호 변경 등). `/연동`으로 다시 연결해 주세요. 이미 모은 메시지는 계속 검색돼요.',
  internalError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  sessionExpired: '검색이 만료됐어요. `/검색`을 다시 입력해 주세요.',
  aiOff: 'AI 검색은 지금은 꺼져 있어요.',
  aiFoot: '정확하지 않을 수 있어요. 정확한 단어를 알면 /검색이 더 확실해요.',
  linked: '연결됐어요. 대화를 모으는 중이에요.',
  unlinked: '연동을 해제하고 이 서버에 있던 대화를 삭제했어요.',
  unlinkAsk: '연동을 해제하면 토큰과 모아 둔 대화가 바로 삭제돼요. 계속할까요?',
  unlinkConfirm: '삭제하기',
  notLinkedYet: '아직 연동되지 않았어요. `/연동`으로 연결해 주세요.',
  syncStarted: '동기화를 시작했어요. `/상태`에서 진행을 볼 수 있어요.',
  risk: '계정 토큰으로 대화를 읽는 것은 디스코드 약관에 어긋날 수 있고, 계정 정지로 이어질 수 있어요. 서버가 실행 중인 채로 완전히 탈취되면 토큰이 노출될 수도 있어요.',
  tokenHelp:
    '브라우저에서 discord.com/app 에 로그인한 뒤 F12 → Network → 필터에 api 입력 → 아무 요청 → Request Headers의 authorization 값을 복사하세요. 이 값은 비밀번호와 같아요. 그거 말고는 아무 데도 붙여넣지 마세요.',
} as const;
