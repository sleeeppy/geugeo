import type { SearchHit } from '../../search/query.js';
import type { AppContext } from '../context.js';
import { renderNotLinked, renderSearch, type Rendered } from '../ui/results.js';
import { channelMissingView, emptyView, errorView, tokenExpiredView } from '../ui/states.js';
import { syncingLine } from '../ui/states.js';

export async function runAiSearch(ctx: AppContext, ownerId: string, query: string, channelId?: string): Promise<Rendered> {
  const user = ctx.registry.get(ownerId);
  if (!user && !ctx.users.hasFile(ownerId)) return renderNotLinked();
  if (user?.status === 'token_invalid' && !ctx.users.hasFile(ownerId)) return tokenExpiredView();
  if (!ctx.users.hasFile(ownerId)) return renderNotLinked();
  const store = ctx.users.get(ownerId);
  if (channelId && !store.getChannel(channelId)) {
    ctx.queue.enqueue(`incremental:${ownerId}`, () => ctx.syncer.incrementalUser(ownerId));
    return channelMissingView();
  }
  try {
    const ranked = await ctx.semantic.search(ownerId, query, channelId);
    const messages = store.messagesByIds(ranked.map((hit) => hit.messageId));
    const hits: SearchHit[] = messages.map((message) => {
      const channel = store.getChannel(message.channelId);
      return {
        ...message,
        recipientName: channel?.recipientName ?? null,
        recipientId: channel?.recipientId ?? null,
        channelType: channel?.type ?? null,
      };
    });
    const sessionId = ctx.sessions.create({
      ownerId,
      query,
      channelId,
      recipientName: channelId ? store.getChannel(channelId)?.recipientName : undefined,
      filters: { author: 'all', kind: 'all', period: 'all' },
      mode: 'ai',
      total: hits.length,
    });
    if (hits.length === 0) return emptyView(query);
    return renderSearch({
      sessionId,
      query,
      hits: hits.slice(0, 5),
      total: hits.length,
      page: 0,
      filters: { author: 'all', kind: 'all', period: 'all' },
      scopeLabel: channelId ? `${store.getChannel(channelId)?.recipientName ?? '대화'} · 이 대화` : '모아 둔 전체',
      singleChannel: Boolean(channelId),
      otherName: channelId ? (store.getChannel(channelId)?.recipientName ?? '상대') : '상대',
      mode: 'ai',
      syncingNote: user?.status === 'syncing' ? syncingLine() : undefined,
    });
  } catch (error) {
    ctx.log.error('AI 검색에 실패했어요.', { error });
    return errorView();
  }
}
