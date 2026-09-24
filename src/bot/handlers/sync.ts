import type { ChatInputCommandInteraction } from 'discord.js';
import { resetFullSync } from '../../sync/syncer.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice } from '../ui/results.js';
import { deniedView, tokenExpiredView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';

export async function handleSync(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const user = ctx.registry.get(interaction.user.id);
  if (!user?.tokenEnc) {
    await interaction.reply(user ? tokenExpiredView() : renderNotice(COPY.notLinkedYet));
    return;
  }
  const full = interaction.options.getBoolean('full') ?? false;
  await interaction.deferReply({ flags: 64 });
  if (full) {
    ctx.queue.enqueue(`backfill:${interaction.user.id}`, () => resetFullSync(ctx.syncer, ctx.users, interaction.user.id));
  } else {
    ctx.queue.enqueue(`incremental:${interaction.user.id}`, async () => {
      await ctx.syncer.incrementalUser(interaction.user.id);
      ctx.semantic.kick(interaction.user.id);
    });
  }
  await interaction.editReply(renderNotice(COPY.syncStarted, COLOR.blurple));
}
