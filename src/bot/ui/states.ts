import { COLOR, COPY } from './theme.js';
import { renderNotice, type Rendered } from './results.js';

export function deniedView(): Rendered {
  return renderNotice(COPY.denied, COLOR.red);
}

export function emptyView(query: string): Rendered {
  return renderNotice(`### 🔍 ${query}\n${COPY.empty(query)}\n-# ${COPY.emptyHint}`);
}

export function channelMissingView(): Rendered {
  return renderNotice(COPY.channelMissing, COLOR.yellow);
}

export function tokenExpiredView(): Rendered {
  return renderNotice(COPY.tokenExpired, COLOR.yellow);
}

export function errorView(): Rendered {
  return renderNotice(COPY.internalError, COLOR.red);
}

export function sessionExpiredView(): Rendered {
  return renderNotice(COPY.sessionExpired, COLOR.yellow);
}

export function aiOffView(): Rendered {
  return renderNotice(`### ✨ AI 검색 (베타)\n${COPY.aiOff}`);
}

export function syncingLine(): string {
  return '-# ⏳ 아직 모으는 중이에요. 사람별 진행은 `/상태`에 나와요. 지금까지 모은 메시지에서 찾았어요.';
}
