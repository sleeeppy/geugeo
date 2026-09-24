import type { ChatInputCommandInteraction } from 'discord.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice } from '../ui/results.js';
import { deniedView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';

export function isSyncJob(name: string, userId: string): boolean {
  return name === `backfill:${userId}` || name === `incremental:${userId}` || name.startsWith(`collect:${userId}:`);
}

export async function handleStop(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const userId = interaction.user.id;
  const user = ctx.registry.get(userId);
  if (!user) {
    await interaction.reply(renderNotice(COPY.notLinkedYet));
    return;
  }
  ctx.syncer.requestStop(userId);
  const removed = ctx.queue.cancelMatching((name) => isSyncJob(name, userId) || name === `embed:${userId}`);
  const running = ctx.queue.currentName != null && isSyncJob(ctx.queue.currentName, userId);
  if (!running) ctx.syncer.clearStop(userId);
  if (!running && removed.length === 0 && user.status !== 'syncing') {
    await interaction.reply(renderNotice(COPY.stopIdle));
    return;
  }
  if (!running) ctx.registry.setStatus(userId, 'paused');
  await interaction.reply(renderNotice(COPY.stopped, COLOR.green));
}
