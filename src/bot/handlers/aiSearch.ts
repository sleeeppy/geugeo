import { type ChatInputCommandInteraction } from 'discord.js';
import { isAllowed } from '../guard.js';
import { openDirectChannelId } from '../dmChannel.js';
import type { AppContext } from '../context.js';
import { deniedView, aiOffView } from '../ui/states.js';
import { handleSearch } from './search.js';

export async function handleAiSearch(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  if (!ctx.config.aiEnabled || !ctx.semantic.enabled) {
    await interaction.reply(aiOffView());
    return;
  }
  const question = interaction.options.getString('question', true);
  const selected = openDirectChannelId(interaction) ?? interaction.options.getString('with');
  await interaction.deferReply({ flags: 64 });
  const { runAiSearch } = await import('./searchRun.js');
  const rendered = await runAiSearch(ctx, interaction.user.id, question, selected ?? undefined);
  await interaction.editReply(rendered);
}
