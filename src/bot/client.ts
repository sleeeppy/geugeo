import { Client, Events, type Interaction } from 'discord.js';
import type { AppContext } from './context.js';
import { handleAiSearch } from './handlers/aiSearch.js';
import { handleCollect } from './handlers/collect.js';
import { handleLink, handleLinkButton, handleLinkModal } from './handlers/link.js';
import { handleRecall, handleSearch, handleSearchComponent } from './handlers/search.js';
import { handleReset, handleResetConfirm } from './handlers/reset.js';
import { handleStatus } from './handlers/status.js';
import { handleStop } from './handlers/stop.js';
import { handleSync } from './handlers/sync.js';
import { handleUnlink, handleUnlinkConfirm } from './handlers/unlink.js';
import { errorView } from './ui/states.js';

export function createBot(ctx: AppContext): Client {
  const client = new Client({ intents: [] });
  client.on(Events.InteractionCreate, (interaction) => {
    void route(interaction, ctx);
  });
  client.on(Events.Error, (error) => ctx.log.error('디스코드 연결 오류', { error }));
  return client;
}

async function route(interaction: Interaction, ctx: AppContext): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await autocomplete(interaction, ctx);
      return;
    }
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'search') return void handleSearch(interaction, ctx);
      if (interaction.commandName === 'recall') return void handleRecall(interaction, ctx);
      if (interaction.commandName === 'ai-search') return void handleAiSearch(interaction, ctx);
      if (interaction.commandName === 'link') return void handleLink(interaction, ctx);
      if (interaction.commandName === 'collect') return void handleCollect(interaction, ctx);
      if (interaction.commandName === 'stop') return void handleStop(interaction, ctx);
      if (interaction.commandName === 'reset') return void handleReset(interaction, ctx);
      if (interaction.commandName === 'unlink') return void handleUnlink(interaction, ctx);
      if (interaction.commandName === 'status') return void handleStatus(interaction, ctx);
      if (interaction.commandName === 'sync') return void handleSync(interaction, ctx);
      return;
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'gg:link:guide' || interaction.customId === 'gg:link:modal') {
        return void handleLinkButton(interaction, ctx);
      }
      if (interaction.customId === 'gg:unlink:confirm') return void handleUnlinkConfirm(interaction, ctx);
      if (interaction.customId === 'gg:reset:confirm') return void handleResetConfirm(interaction, ctx);
      if (interaction.customId.startsWith('gg:page:')) return void handleSearchComponent(interaction, ctx);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('gg:filter:')) {
      return void handleSearchComponent(interaction, ctx);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'gg:link:submit') {
      return void handleLinkModal(interaction, ctx);
    }
  } catch (error) {
    ctx.log.error('명령을 처리하지 못했어요.', { error });
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply(errorView()).catch(() => undefined);
    }
  }
}

async function autocomplete(interaction: Interaction, ctx: AppContext): Promise<void> {
  if (!interaction.isAutocomplete()) return;
  if (!ctx.config.allowedUserIds.has(interaction.user.id) || !ctx.users.hasFile(interaction.user.id)) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'with') {
    await interaction.respond([]);
    return;
  }
  const choices = ctx.users
    .get(interaction.user.id)
    .searchRecipients(String(focused.value), 25)
    .map((channel) => ({ name: channel.name.slice(0, 100), value: channel.id }));
  await interaction.respond(choices);
}
