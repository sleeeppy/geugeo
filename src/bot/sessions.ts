import { randomBytes } from 'node:crypto';
import type { AuthorFilter, KindFilter, PeriodFilter } from '../search/query.js';

const TTL_MS = 15 * 60 * 1000;

export interface SessionFilters {
  author: AuthorFilter;
  kind: KindFilter;
  period: PeriodFilter;
}

export interface SearchSession {
  ownerId: string;
  query: string;
  channelId?: string;
  recipientName?: string;
  filters: SessionFilters;
  mode: 'keyword' | 'ai';
  total: number;
  createdAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SearchSession>();

  create(session: Omit<SearchSession, 'createdAt'>): string {
    this.sweep();
    const id = randomBytes(4).toString('hex');
    this.sessions.set(id, { ...session, createdAt: Date.now() });
    return id;
  }

  get(id: string): SearchSession | null {
    this.sweep();
    return this.sessions.get(id) ?? null;
  }

  update(id: string, patch: Partial<SearchSession>): void {
    const current = this.sessions.get(id);
    if (!current) return;
    this.sessions.set(id, { ...current, ...patch });
  }

  deleteUser(userId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.ownerId === userId) this.sessions.delete(id);
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, session] of this.sessions) {
      if (session.createdAt < cutoff) this.sessions.delete(id);
    }
  }
}
