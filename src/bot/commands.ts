import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';

const contexts = [InteractionContextType.BotDM, InteractionContextType.PrivateChannel, InteractionContextType.Guild];

function base(name: string, ko: string, description: string, koDescription: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setNameLocalizations({ ko })
    .setDescription(description)
    .setDescriptionLocalizations({ ko: koDescription })
    .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
    .setContexts(...contexts);
}

export function buildCommands(): SlashCommandBuilder[] {
  const search = base('search', '검색', 'Find text in your DMs', '1:1 DM에서 글자를 찾아요');
  search
    .addStringOption((option) =>
      option
        .setName('query')
        .setNameLocalizations({ ko: '검색어' })
        .setDescription('Text that must appear')
        .setDescriptionLocalizations({ ko: '포함되어야 하는 글자' })
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('author')
        .setNameLocalizations({ ko: '보낸사람' })
        .setDescription('Who sent it')
        .setDescriptionLocalizations({ ko: '누가 보냈는지' })
        .addChoices(
          { name: '전체', value: 'all' },
          { name: '나', value: 'me' },
          { name: '상대', value: 'other' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('kind')
        .setNameLocalizations({ ko: '종류' })
        .setDescription('Message kind')
        .setDescriptionLocalizations({ ko: '메시지 종류' })
        .addChoices(
          { name: '전체', value: 'all' },
          { name: '링크', value: 'link' },
          { name: '유튜브', value: 'youtube' },
          { name: '이미지', value: 'image' },
          { name: '파일', value: 'file' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('period')
        .setNameLocalizations({ ko: '기간' })
        .setDescription('How far back')
        .setDescriptionLocalizations({ ko: '얼마나 과거까지' })
        .addChoices(
          { name: '전체', value: 'all' },
          { name: '7일', value: '7d' },
          { name: '30일', value: '30d' },
          { name: '1년', value: '1y' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('with')
        .setNameLocalizations({ ko: '상대' })
        .setDescription('Which DM, outside a DM')
        .setDescriptionLocalizations({ ko: 'DM 밖에서 고를 대화 상대' })
        .setAutocomplete(true),
    );

  const ai = base('ai-search', 'ai검색', 'Search DMs by meaning', '말로 풀어서 DM을 찾아요 (베타)');
  ai.addStringOption((option) =>
    option
      .setName('question')
      .setNameLocalizations({ ko: '질문' })
      .setDescription('What you are trying to remember')
      .setDescriptionLocalizations({ ko: '기억하려는 내용' })
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(200),
  ).addStringOption((option) =>
    option
      .setName('with')
      .setNameLocalizations({ ko: '상대' })
      .setDescription('Which DM')
      .setDescriptionLocalizations({ ko: '대화 상대' })
      .setAutocomplete(true),
  );

  const sync = base('sync', '동기화', 'Fetch new DM messages', '새 DM 메시지를 가져와요');
  sync.addBooleanOption((option) =>
    option
      .setName('full')
      .setNameLocalizations({ ko: '전체' })
      .setDescription('Rebuild the whole history')
      .setDescriptionLocalizations({ ko: '과거 기록 전체를 다시 모아요' }),
  );

  return [
    search,
    ai,
    base('link', '연동', 'Connect your Discord account', '계정 토큰을 연결해요'),
    base('unlink', '연동해제', 'Delete the token and saved DMs', '토큰과 모아 둔 대화를 삭제해요'),
    base('status', '상태', 'Show sync progress', '연동과 동기화 상태를 보여줘요'),
    sync,
  ];
}
