import type { AppContext } from './context.js';
import type { PersonProgress } from './ui/theme.js';

export function personRows(ctx: AppContext, userId: string): PersonProgress[] {
  if (!ctx.users.hasFile(userId)) return [];
  const store = ctx.users.get(userId);
  return store.listTracked().map((channel) => ({
    name: channel.recipientName,
    count: store.countMessages(channel.id),
    state: channel.backfillDone ? 'done' : ctx.syncer.isCollecting(userId, channel.id) ? 'active' : 'waiting',
  }));
}
