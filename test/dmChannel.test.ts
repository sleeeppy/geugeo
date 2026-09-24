import { ChannelType, InteractionContextType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { openDirectChannelId } from '../src/bot/dmChannel.js';

function interaction(partial: Record<string, unknown>) {
  return {
    guildId: null,
    channelId: '10',
    context: InteractionContextType.PrivateChannel,
    channel: null,
    client: { user: { id: 'bot' } },
    ...partial,
  } as never;
}

describe('open DM detection', () => {
  it('treats an uncached private channel as the open 1:1 DM', () => {
    expect(openDirectChannelId(interaction({}))).toBe('10');
  });

  it('rejects guilds, the bot DM, and group DMs', () => {
    expect(openDirectChannelId(interaction({ guildId: '99' }))).toBeNull();
    expect(openDirectChannelId(interaction({ context: InteractionContextType.BotDM }))).toBeNull();
    expect(openDirectChannelId(interaction({ channel: { type: ChannelType.GroupDM } }))).toBeNull();
    expect(
      openDirectChannelId(interaction({ channel: { type: ChannelType.DM, recipientId: 'bot' } })),
    ).toBeNull();
  });
});
