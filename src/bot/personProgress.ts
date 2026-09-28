import type { AppContext } from './context.js';
import type { PersonProgress } from './ui/theme.js';

export function personRows(ctx: AppContext, userId: string, recipientId?: string): PersonProgress[] {
  if (!ctx.users.hasFile(userId)) return [];
  const store = ctx.users.get(userId);
  return store
    .listTracked()
    .filter((channel) => recipientId == null || channel.recipientId === recipientId)
    .map((channel) => ({
      name: channel.recipientName,
      count: store.countMessages(channel.id),
      state: channel.backfillDone ? 'done' : ctx.syncer.isCollecting(userId, channel.id) ? 'active' : 'waiting',
    }));
}
