import type { ChatInputCommandInteraction } from 'discord.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice } from '../ui/results.js';
import { deniedView } from '../ui/states.js';
import { personRows } from '../personProgress.js';
import { COLOR, COPY, renderPersonList } from '../ui/theme.js';

export async function handleStatus(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const user = ctx.registry.get(interaction.user.id);
  if (!user) {
    await interaction.reply(renderNotice(COPY.notLinkedYet));
    return;
  }
  const rows = personRows(ctx, interaction.user.id);
  const messages = rows.reduce((sum, row) => sum + row.count, 0);
  const progress = ctx.semantic.progress(interaction.user.id);
  const moving = rows.some((row) => row.state !== 'done');
  const lines = [
    `### 상태`,
    statusLine(user.status),
    user.lastError ? `-# ${user.lastError}` : '',
    rows.length > 0 ? renderPersonList(rows, 25) : '아직 모으기 시작한 대화가 없어요.',
    rows.length > 0 ? `-# 합계 대화 ${rows.length.toLocaleString('ko-KR')}개 · 메시지 ${messages.toLocaleString('ko-KR')}개` : '',
    moving ? '-# 한 대화가 어디서 끝나는지는 모으기 전에 알 수 없어요. 개수가 올라가고, 그 대화가 끝나면 100%가 돼요.' : '',
    user.lastSyncAt ? `마지막 동기화 <t:${Math.floor(user.lastSyncAt / 1000)}:R>` : '아직 동기화가 끝난 적이 없어요.',
    ctx.semantic.enabled ? `AI 임베딩 ${progress.embedded.toLocaleString('ko-KR')}/${progress.eligible.toLocaleString('ko-KR')} (베타)` : 'AI 검색은 꺼져 있어요.',
  ].filter(Boolean);
  const accent = user.status === 'error' || user.status === 'token_invalid' ? COLOR.yellow : COLOR.blurple;
  await interaction.reply(renderNotice(lines.join('\n'), accent));
}

function statusLine(status: string): string {
  if (status === 'ready') return '준비됐어요.';
  if (status === 'syncing') return '대화를 모으는 중이에요.';
  if (status === 'paused') return '수집을 멈춰 둔 상태예요.';
  if (status === 'token_invalid') return COPY.tokenExpired;
  return '마지막 동기화에서 문제가 있었어요.';
}
