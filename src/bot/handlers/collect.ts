import { InteractionContextType, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { TokenInvalidError } from '../../discord/userApi.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderCollectAllChoice, renderNotice } from '../ui/results.js';
import { deniedView, errorView, tokenExpiredView } from '../ui/states.js';
import { personRows } from '../personProgress.js';
import { COLOR, COPY, formatPersonProgress, renderPersonList } from '../ui/theme.js';
import { SyncStopped, type CollectScope } from '../../sync/syncer.js';
import { openDirectChannelId } from '../dmChannel.js';

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
  const channelId = openDirectChannelId(interaction);
  if (!channelId) {
    const botDm = interaction.context === InteractionContextType.BotDM;
    await interaction.reply(renderNotice(botDm ? COPY.notBotDm : COPY.notDm, COLOR.yellow));
    return;
  }
  await interaction.deferReply({ flags: 64 });
  try {
    const name = await ctx.syncer.beginCollect(interaction.user.id, channelId);
    if (!name) {
      await interaction.editReply(renderNotice(COPY.notDm, COLOR.yellow));
      return;
    }
    ctx.queue.enqueue(`collect:${interaction.user.id}:${channelId}`, () => ctx.syncer.collectChannel(interaction.user.id, channelId));
    const userId = interaction.user.id;
    const initialCount = ctx.users.hasFile(userId) ? ctx.users.get(userId).countMessages(channelId) : 0;
    const initialState = ctx.syncer.isCollecting(userId, channelId) ? 'active' : 'waiting';
    await interaction.editReply(renderNotice(`### 수집\n${formatPersonProgress(name, initialCount, initialState)}`, COLOR.green));
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 14 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      const current = ctx.registry.get(userId);
      const store = ctx.users.hasFile(userId) ? ctx.users.get(userId) : null;
      const channel = store?.getChannel(channelId);
      const count = store?.countMessages(channelId) ?? 0;
      const state = channel?.backfillDone ? 'done' : ctx.syncer.isCollecting(userId, channelId) ? 'active' : 'waiting';
      const stopped = !current || current.status === 'paused' || current.status === 'error' || current.status === 'token_invalid';
      if (state === 'done' || stopped) clearInterval(timer);
      const line =
        current?.status === 'paused'
          ? COPY.stopped
          : state === 'done'
            ? COPY.collected(name, count)
            : formatPersonProgress(name, count, state);
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
    const userId = interaction.user.id;
    ctx.queue.enqueue(`collect-all:${userId}`, () => ctx.syncer.collectAll(userId));
    await interaction.editReply(renderNotice(`### 전체수집\n${scopeLabel} 범위를 모으는 중이에요.`, COLOR.green));
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 14 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      const current = ctx.registry.get(userId);
      const rows = personRows(ctx, userId);
      const messages = rows.reduce((sum, row) => sum + row.count, 0);
      const stopped = !current || current.status === 'paused' || current.status === 'error' || current.status === 'token_invalid';
      if (current?.status === 'ready' || stopped) clearInterval(timer);
      const line =
        current?.status === 'paused'
          ? COPY.stopped
          : current?.status === 'ready'
            ? `${COPY.collectedAll(scopeLabel, rows.length, messages)}\n${renderPersonList(rows)}`
            : `${scopeLabel} 범위를 모으는 중이에요.\n${renderPersonList(rows)}`;
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
