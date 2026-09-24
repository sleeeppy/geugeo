import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice, renderResetConfirm } from '../ui/results.js';
import { deniedView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';
import { isSyncJob } from './stop.js';

export async function handleReset(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  if (!ctx.registry.get(interaction.user.id)) {
    await interaction.reply(renderNotice(COPY.notLinkedYet));
    return;
  }
  if (!ctx.users.hasFile(interaction.user.id) || ctx.users.get(interaction.user.id).countMessages() === 0) {
    await interaction.reply(renderNotice(COPY.resetEmpty));
    return;
  }
  await interaction.reply(renderResetConfirm());
}

export async function handleResetConfirm(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const userId = interaction.user.id;
  ctx.syncer.requestStop(userId);
  ctx.queue.cancelMatching((name) => isSyncJob(name, userId) || name === `embed:${userId}`);
  const running = ctx.queue.currentName != null && isSyncJob(ctx.queue.currentName, userId);
  if (!running) ctx.syncer.clearStop(userId);
  const removed = ctx.users.hasFile(userId) ? ctx.users.get(userId).wipe() : { messages: 0, channels: 0 };
  ctx.registry.setStatus(userId, 'ready');
  ctx.registry.clearProgress(userId);
  ctx.sessions.deleteUser(userId);
  await interaction.update(renderNotice(COPY.resetDone(removed.messages), COLOR.green));
}
