import { ChannelType, type ChatInputCommandInteraction, type DMChannel } from 'discord.js';
import { TokenInvalidError } from '../../discord/userApi.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice } from '../ui/results.js';
import { deniedView, errorView, tokenExpiredView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';

export async function handleCollect(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const user = ctx.registry.get(interaction.user.id);
  if (!user?.tokenEnc) {
    await interaction.reply(user ? tokenExpiredView() : renderNotice(COPY.notLinkedYet));
    return;
  }
  const channel = interaction.channel;
  if (channel?.type === ChannelType.DM && (channel as DMChannel).recipientId === interaction.client.user?.id) {
    await interaction.reply(renderNotice(COPY.notBotDm, COLOR.yellow));
    return;
  }
  if (channel && channel.type !== ChannelType.DM) {
    await interaction.reply(renderNotice(COPY.notDm, COLOR.yellow));
    return;
  }
  await interaction.deferReply({ flags: 64 });
  try {
    const name = await ctx.syncer.beginCollect(interaction.user.id, interaction.channelId);
    if (!name) {
      await interaction.editReply(renderNotice(COPY.notDm, COLOR.yellow));
      return;
    }
    ctx.queue.enqueue(`collect:${interaction.user.id}:${interaction.channelId}`, () =>
      ctx.syncer.collectChannel(interaction.user.id, interaction.channelId),
    );
    await interaction.editReply(renderNotice(`### 수집\n${COPY.collecting(name)}`, COLOR.green));
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 14 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      const current = ctx.registry.get(interaction.user.id);
      if (!current || current.status === 'ready' || current.status === 'error' || current.status === 'token_invalid') {
        clearInterval(timer);
      }
      const count = current?.progress?.messages ?? 0;
      const line = current?.status === 'ready' ? COPY.collected(name, count) : `${COPY.collecting(name)}\n-# 메시지 ${count.toLocaleString('ko-KR')}개`;
      const accent = current?.status === 'error' || current?.status === 'token_invalid' ? COLOR.red : COLOR.green;
      void interaction.editReply(renderNotice(`### 수집\n${line}`, accent)).catch(() => clearInterval(timer));
    }, 10_000);
    timer.unref?.();
  } catch (error) {
    if (error instanceof TokenInvalidError) {
      await interaction.editReply(renderNotice('토큰이 거부됐어요. `/연동`으로 다시 넣어 주세요.', COLOR.red));
      return;
    }
    ctx.log.error('수집을 시작하지 못했어요.', { error });
    await interaction.editReply(errorView());
  }
}
