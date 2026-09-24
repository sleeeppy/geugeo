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
  const search = queryCommand(
    'search',
    '그거',
    'Find text in this DM',
    '이 1:1 DM에서 글자를 찾아요',
    'query',
    '검색어',
    'Text that must appear',
    '포함되어야 하는 글자',
  );
  const recall = queryCommand(
    'recall',
    '그거뭐지',
    'Find text across collected DMs',
    '모아 둔 DM 전체에서 글자를 찾아요',
    'query',
    '검색어',
    'Text that must appear',
    '포함되어야 하는 글자',
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

  const sync = base('sync', '동기화', 'Fetch new messages from collected DMs', '수집해 둔 DM의 새 메시지를 가져와요');
  sync.addBooleanOption((option) =>
    option
      .setName('full')
      .setNameLocalizations({ ko: '전체' })
      .setDescription('Rebuild collected DM history')
      .setDescriptionLocalizations({ ko: '수집해 둔 대화의 과거를 다시 모아요' }),
  );

  return [
    search,
    recall,
    ai,
    base('link', '연동', 'Connect your Discord account', '계정 토큰을 연결해요'),
    base('collect', '수집', 'Save this DM', '이 1:1 DM만 모아요'),
    base('stop', '중지', 'Stop collecting messages', '진행 중인 수집을 멈춰요'),
    base('reset', '초기화', 'Delete saved DM messages', '모아 둔 DM 메시지를 전부 삭제해요'),
    base('unlink', '연동해제', 'Delete the token and saved DMs', '토큰과 모아 둔 대화를 삭제해요'),
    base('status', '상태', 'Show sync progress', '연동과 동기화 상태를 보여줘요'),
    sync,
  ];
}

function queryCommand(
  name: string,
  ko: string,
  description: string,
  koDescription: string,
  optionName: string,
  optionKo: string,
  optionDescription: string,
  optionKoDescription: string,
): SlashCommandBuilder {
  const command = base(name, ko, description, koDescription);
  command
    .addStringOption((option) =>
      option
        .setName(optionName)
        .setNameLocalizations({ ko: optionKo })
        .setDescription(optionDescription)
        .setDescriptionLocalizations({ ko: optionKoDescription })
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
    );
  return command;
}
