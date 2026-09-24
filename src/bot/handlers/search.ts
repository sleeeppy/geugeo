import { ChannelType, type ChatInputCommandInteraction, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { searchMessages, SearchInputError, type AuthorFilter, type KindFilter, type PeriodFilter, type SearchHit } from '../../search/query.js';
import type { RegistryUser } from '../../store/registry.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import type { SearchSession, SessionFilters } from '../sessions.js';
import { renderNotLinked, renderSearch, type Rendered } from '../ui/results.js';
import { channelMissingView, deniedView, emptyView, errorView, sessionExpiredView, syncingLine, tokenExpiredView } from '../ui/states.js';
import { COPY } from '../ui/theme.js';

const DEFAULT_FILTERS: SessionFilters = { author: 'all', kind: 'all', period: 'all' };

export async function handleSearch(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!(await allow(interaction, ctx))) return;
  await interaction.deferReply({ flags: 64 });
  try {
    const query = interaction.options.getString('query', true);
    const filters: SessionFilters = {
      author: choice(interaction.options.getString('author'), DEFAULT_FILTERS.author),
      kind: choice(interaction.options.getString('kind'), DEFAULT_FILTERS.kind),
      period: choice(interaction.options.getString('period'), DEFAULT_FILTERS.period),
    };
    const channelId = resolveChannel(interaction, interaction.options.getString('with'));
    const rendered = await runSearch(ctx, {
      ownerId: interaction.user.id,
      query,
      channelId,
      filters,
      mode: 'keyword',
      page: 0,
    });
    await interaction.editReply(rendered);
  } catch (error) {
    if (error instanceof SearchInputError) {
      await interaction.editReply(emptyView(error.message));
      return;
    }
    ctx.log.error('검색에 실패했어요.', { error });
    await interaction.editReply(errorView());
  }
}

export async function handleSearchComponent(interaction: ButtonInteraction | StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply({ ...deniedView(), ephemeral: undefined });
    return;
  }
  const customId = interaction.customId;
  const parts = customId.split(':');
  const sessionId = parts[1] === 'page' ? (parts[2] ?? '') : (parts.at(-1) ?? '');
  const session = ctx.sessions.get(sessionId);
  if (!session || session.ownerId !== interaction.user.id) {
    await interaction.update(sessionExpiredView());
    return;
  }
  let page = 0;
  if (customId.startsWith('gg:page:')) {
    page = Number(customId.split(':')[3] ?? 0);
  }
  if (interaction.isStringSelectMenu() && customId.startsWith('gg:filter:author:')) {
    session.filters.author = choice(interaction.values[0], session.filters.author);
    page = 0;
  }
  if (interaction.isStringSelectMenu() && customId.startsWith('gg:filter:kind:')) {
    session.filters.kind = choice(interaction.values[0], session.filters.kind);
    page = 0;
  }
  ctx.sessions.update(sessionId, session);
  try {
    const rendered = await renderSession(ctx, session, sessionId, page);
    await interaction.update(rendered);
  } catch (error) {
    ctx.log.error('결과 화면을 바꾸지 못했어요.', { error });
    await interaction.update(errorView());
  }
}

async function runSearch(
  ctx: AppContext,
  input: Omit<SearchSession, 'createdAt' | 'total' | 'recipientName'> & { page: number },
): Promise<Rendered> {
  const user = ctx.registry.get(input.ownerId);
  if (!user && !ctx.users.hasFile(input.ownerId)) return renderNotLinked();
  if (user?.status === 'token_invalid' && !ctx.users.hasFile(input.ownerId)) return tokenExpiredView();
  const storeReady = ctx.users.hasFile(input.ownerId);
  if (input.channelId && storeReady && !ctx.users.get(input.ownerId).getChannel(input.channelId)) {
    ctx.queue.enqueue(`incremental:${input.ownerId}`, () => ctx.syncer.incrementalUser(input.ownerId));
    return channelMissingView();
  }
  if (input.channelId && user?.tokenEnc) {
    await Promise.race([ctx.syncer.incrementalChannel(input.ownerId, input.channelId), sleep(2000)]);
  }
  const recipientName = input.channelId && storeReady ? ctx.users.get(input.ownerId).getChannel(input.channelId)?.recipientName : undefined;
  const sessionId = ctx.sessions.create({
    ownerId: input.ownerId,
    query: input.query,
    channelId: input.channelId,
    recipientName,
    filters: input.filters,
    mode: input.mode,
    total: 0,
  });
  const session = ctx.sessions.get(sessionId);
  if (!session) return errorView();
  return renderSession(ctx, session, sessionId, input.page);
}

async function renderSession(ctx: AppContext, session: SearchSession, sessionId: string, page: number): Promise<Rendered> {
  if (!ctx.users.hasFile(session.ownerId)) return renderNotLinked();
  const store = ctx.users.get(session.ownerId);
  let hits: SearchHit[] = [];
  let total = 0;
  if (session.mode === 'ai') {
    const ranked = await ctx.semantic.search(session.ownerId, session.query, session.channelId);
    const messages = store.messagesByIds(ranked.map((hit) => hit.messageId));
    const filtered = messages.filter((message) => matchesFilters(message, session, session.ownerId));
    total = filtered.length;
    hits = filtered.slice(page * 5, page * 5 + 5).map((message) => ({
      ...message,
      recipientName: store.getChannel(message.channelId)?.recipientName ?? null,
    }));
  } else {
    const result = searchMessages(store.db, {
      raw: session.query,
      requesterId: session.ownerId,
      channelId: session.channelId,
      filters: session.filters,
      page,
    });
    hits = result.hits;
    total = result.total;
  }
  ctx.sessions.update(sessionId, { total });
  if (total === 0) return emptyView(session.query);
  const registryUser = ctx.registry.get(session.ownerId);
  return renderSearch({
    sessionId,
    query: session.query,
    hits,
    total,
    page,
    filters: session.filters,
    scoped: Boolean(session.channelId),
    recipientName: session.recipientName,
    mode: session.mode,
    syncingNote: syncingNote(registryUser),
  });
}

function matchesFilters(message: { authorId: string; ts: number; hasLink: boolean; hasYoutube: boolean; hasImage: boolean; hasFile: boolean }, session: SearchSession, ownerId: string): boolean {
  if (session.filters.author === 'me' && message.authorId !== ownerId) return false;
  if (session.filters.author === 'other' && message.authorId === ownerId) return false;
  if (session.filters.kind === 'link' && !message.hasLink) return false;
  if (session.filters.kind === 'youtube' && !message.hasYoutube) return false;
  if (session.filters.kind === 'image' && !message.hasImage) return false;
  if (session.filters.kind === 'file' && !message.hasFile) return false;
  return true;
}

function syncingNote(user: RegistryUser | null): string | undefined {
  if (user?.status !== 'syncing' || !user.progress) return undefined;
  return syncingLine(user.progress.channelsDone, user.progress.channelsTotal, user.progress.messages);
}

function resolveChannel(interaction: ChatInputCommandInteraction, selected: string | null): string | undefined {
  if (interaction.channel?.type === ChannelType.DM) return interaction.channelId;
  return selected ?? undefined;
}

function choice<T extends string>(value: string | null, fallback: T): T {
  return (value as T | null) ?? fallback;
}

async function allow(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<boolean> {
  if (isAllowed(ctx.config, interaction.user.id)) return true;
  await interaction.reply(deniedView());
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { COPY };
