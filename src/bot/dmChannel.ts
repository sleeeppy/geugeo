import { ChannelType, InteractionContextType, type ChatInputCommandInteraction, type DMChannel } from 'discord.js';

export function openDirectChannelId(interaction: ChatInputCommandInteraction): string | null {
  if (interaction.guildId || interaction.context === InteractionContextType.BotDM) return null;
  const channel = interaction.channel;
  if (channel?.type === ChannelType.GroupDM) return null;
  if (channel?.type === ChannelType.DM) {
    if ((channel as DMChannel).recipientId === interaction.client.user?.id) return null;
    return channel.id;
  }
  if (interaction.context === InteractionContextType.PrivateChannel && interaction.channelId) return interaction.channelId;
  return null;
}
