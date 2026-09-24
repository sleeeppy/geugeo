import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { removeUserDbFiles } from '../../store/registry.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderNotice, renderUnlinkConfirm } from '../ui/results.js';
import { deniedView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';

export async function handleUnlink(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  if (!ctx.registry.get(interaction.user.id)) {
    await interaction.reply(renderNotice(COPY.notLinkedYet));
    return;
  }
  await interaction.reply(renderUnlinkConfirm());
}

export async function handleUnlinkConfirm(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  const userId = interaction.user.id;
  ctx.users.close(userId);
  ctx.registry.delete(userId);
  removeUserDbFiles(ctx.config.dataDir, userId);
  ctx.sessions.deleteUser(userId);
  await interaction.update(renderNotice(COPY.unlinked, COLOR.green));
}
