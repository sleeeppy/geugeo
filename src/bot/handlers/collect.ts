import { ChannelType, type ButtonInteraction, type ChatInputCommandInteraction, type DMChannel } from 'discord.js';
import { TokenInvalidError } from '../../discord/userApi.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderCollectAllChoice, renderNotice } from '../ui/results.js';
import { deniedView, errorView, tokenExpiredView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';
import { SyncStopped, type CollectScope } from '../../sync/syncer.js';

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
  if (!channel || channel.type !== ChannelType.DM) {
    await interaction.reply(renderNotice(COPY.notDm, COLOR.yellow));
    return;
  }
  if ((channel as DMChannel).recipientId === interaction.client.user?.id) {
    await interaction.reply(renderNotice(COPY.notBotDm, COLOR.yellow));
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
    }, 3_000);
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

export async function handleCollectAll(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const user = ctx.registry.get(interaction.user.id);
  if (!user?.tokenEnc) {
    await interaction.reply(user ? tokenExpiredView() : renderNotice(COPY.notLinkedYet));
    return;
  }
  await interaction.reply(renderCollectAllChoice());
}

export async function handleCollectAllButton(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const user = ctx.registry.get(interaction.user.id);
  if (!user?.tokenEnc) {
    await interaction.reply(user ? tokenExpiredView() : renderNotice(COPY.notLinkedYet));
    return;
  }
  if (user.status === 'syncing') {
    await interaction.reply(renderNotice(COPY.alreadySyncing, COLOR.yellow));
    return;
  }
  const scope: CollectScope = interaction.customId.endsWith(':server') ? 'server' : 'dm';
  const scopeLabel = scope === 'server' ? 'DM과 서버' : 'DM';
  await interaction.deferUpdate();
  await interaction.editReply(renderNotice(`### 전체수집\n${scopeLabel} 목록을 확인하는 중이에요.`, COLOR.blurple));
  try {
    const total = await ctx.syncer.beginCollectAll(interaction.user.id, scope);
    if (total === 0) {
      ctx.registry.setStatus(interaction.user.id, 'ready');
      await interaction.editReply(renderNotice(`### 전체수집\n${COPY.noDms}`, COLOR.yellow));
      return;
    }
    ctx.queue.enqueue(`collect-all:${interaction.user.id}`, () => ctx.syncer.collectAll(interaction.user.id));
    await interaction.editReply(renderNotice(`### 전체수집\n${COPY.collectingAll(scopeLabel, 0, total, 0)}`, COLOR.green));
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 14 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      const current = ctx.registry.get(interaction.user.id);
      if (!current || current.status === 'ready' || current.status === 'paused' || current.status === 'error' || current.status === 'token_invalid') {
        clearInterval(timer);
      }
      const done = current?.progress?.channelsDone ?? 0;
      const channels = current?.progress?.channelsTotal ?? total;
      const messages = current?.progress?.messages ?? 0;
      const line =
        current?.status === 'paused'
          ? COPY.stopped
          : current?.status === 'ready'
            ? COPY.collectedAll(scopeLabel, channels, messages)
            : COPY.collectingAll(scopeLabel, done, channels, messages);
      const accent = current?.status === 'error' || current?.status === 'token_invalid' ? COLOR.red : COLOR.green;
      void interaction.editReply(renderNotice(`### 전체수집\n${line}`, accent)).catch(() => clearInterval(timer));
    }, 3_000);
    timer.unref?.();
  } catch (error) {
    if (error instanceof SyncStopped) {
      await interaction.editReply(renderNotice(`### 전체수집\n${COPY.stopped}`, COLOR.green));
      return;
    }
    if (error instanceof TokenInvalidError) {
      await interaction.editReply(renderNotice('토큰이 거부됐어요. `/연동`으로 다시 넣어 주세요.', COLOR.red));
      return;
    }
    ctx.log.error('전체 수집을 시작하지 못했어요.', { error });
    await interaction.editReply(errorView());
  }
}
