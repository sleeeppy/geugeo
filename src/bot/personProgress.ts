import type { AppContext } from './context.js';
import type { PersonProgress } from './ui/theme.js';

export function personRows(ctx: AppContext, userId: string, recipientId?: string | readonly string[]): PersonProgress[] {
  if (!ctx.users.hasFile(userId)) return [];
  const store = ctx.users.get(userId);
  const allowed = recipientId == null ? null : new Set(typeof recipientId === 'string' ? [recipientId] : recipientId);
  return store
    .listTracked()
    .filter((channel) => allowed == null || allowed.has(channel.recipientId))
    .map((channel) => ({
      name: channel.recipientName,
      count: store.countMessages(channel.id),
      state: channel.backfillDone ? 'done' : ctx.syncer.isCollecting(userId, channel.id) ? 'active' : 'waiting',
    }));
}
