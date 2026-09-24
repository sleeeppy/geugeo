import type { ChatInputCommandInteraction } from 'discord.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice } from '../ui/results.js';
import { deniedView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';

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
  const counts = ctx.users.hasFile(interaction.user.id)
    ? {
        channels: ctx.users.get(interaction.user.id).listTracked().length,
        messages: ctx.users.get(interaction.user.id).countMessages(),
      }
    : { channels: 0, messages: 0 };
  const progress = ctx.semantic.progress(interaction.user.id);
  const lines = [
    `### 상태`,
    statusLine(user.status),
    user.lastError ? `-# ${user.lastError}` : '',
    `대화 ${counts.channels.toLocaleString('ko-KR')}개 · 메시지 ${counts.messages.toLocaleString('ko-KR')}개`,
    user.progress ? `진행 ${user.progress.channelsDone}/${user.progress.channelsTotal} · ${user.progress.messages.toLocaleString('ko-KR')}개` : '',
    user.lastSyncAt ? `마지막 동기화 <t:${Math.floor(user.lastSyncAt / 1000)}:R>` : '아직 동기화가 끝난 적이 없어요.',
    ctx.semantic.enabled ? `AI 임베딩 ${progress.embedded.toLocaleString('ko-KR')}/${progress.eligible.toLocaleString('ko-KR')} (베타)` : 'AI 검색은 꺼져 있어요.',
  ].filter(Boolean);
  const accent = user.status === 'error' || user.status === 'token_invalid' ? COLOR.yellow : COLOR.blurple;
  await interaction.reply(renderNotice(lines.join('\n'), accent));
}

function statusLine(status: string): string {
  if (status === 'ready') return '준비됐어요.';
  if (status === 'syncing') return '대화를 모으는 중이에요.';
  if (status === 'token_invalid') return COPY.tokenExpired;
  return '마지막 동기화에서 문제가 있었어요.';
}
