import type Database from 'better-sqlite3-multiple-ciphers';
import type { StoredMessage } from '../store/userStore.js';

export const PAGE_SIZE = 5;

export type AuthorFilter = 'all' | 'me' | 'other';
export type KindFilter = 'all' | 'link' | 'youtube' | 'image' | 'file';
export type PeriodFilter = 'all' | '7d' | '30d' | '1y';

export interface SearchFilters {
  author: AuthorFilter;
  kind: KindFilter;
  period: PeriodFilter;
}

export interface SearchInput {
  raw: string;
  requesterId: string;
  channelId?: string;
  filters: SearchFilters;
  page: number;
  now?: number;
}

export interface SearchHit extends StoredMessage {
  recipientName: string | null;
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  hits: SearchHit[];
  terms: string[];
}

export class SearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchInputError';
  }
}

interface HitRow {
  id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  search_text: string;
  ts: number;
  edited_ts: number | null;
  has_link: number;
  has_image: number;
  has_file: number;
  has_youtube: number;
  attachments: string | null;
  recipient_name: string | null;
}

export function parseTerms(raw: string): string[] {
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 100) {
    throw new SearchInputError('검색어는 1자에서 100자까지예요.');
  }
  return trimmed.split(/\s+/).filter((term) => term.length > 0);
}

export function searchMessages(db: Database.Database, input: SearchInput): SearchResult {
  const terms = parseTerms(input.raw);
  const ftsTerms = terms.filter((term) => [...term].length >= 3);
  const likeTerms = terms.filter((term) => [...term].length < 3);
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (ftsTerms.length > 0) {
    const match = ftsTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
    where.push(`m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)`);
    params.push(match);
  }
  for (const term of likeTerms) {
    where.push(`m.search_text LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(term)}%`);
  }
  if (input.channelId) {
    where.push('m.channel_id = ?');
    params.push(input.channelId);
  }
  if (input.filters.author === 'me') {
    where.push('m.author_id = ?');
    params.push(input.requesterId);
  } else if (input.filters.author === 'other') {
    where.push('m.author_id != ?');
    params.push(input.requesterId);
  }
  const kindColumn = kindToColumn(input.filters.kind);
  if (kindColumn) where.push(`m.${kindColumn} = 1`);
  const since = periodStart(input.filters.period, input.now ?? Date.now());
  if (since != null) {
    where.push('m.ts >= ?');
    params.push(since);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM messages m LEFT JOIN channels c ON c.id = m.channel_id ${whereSql}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
  const page = Math.max(0, input.page);
  const rows = db
    .prepare(
      `SELECT m.*, c.recipient_name AS recipient_name ${from}
       ORDER BY m.ts DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, page * PAGE_SIZE) as HitRow[];

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    terms,
    hits: rows.map(mapHit),
  };
}

function kindToColumn(kind: KindFilter): string | null {
  if (kind === 'link') return 'has_link';
  if (kind === 'youtube') return 'has_youtube';
  if (kind === 'image') return 'has_image';
  if (kind === 'file') return 'has_file';
  return null;
}

function periodStart(period: PeriodFilter, now: number): number | null {
  const day = 24 * 60 * 60 * 1000;
  if (period === '7d') return now - 7 * day;
  if (period === '30d') return now - 30 * day;
  if (period === '1y') return now - 365 * day;
  return null;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function mapHit(row: HitRow): SearchHit {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    searchText: row.search_text,
    ts: row.ts,
    editedTs: row.edited_ts,
    hasLink: row.has_link === 1,
    hasImage: row.has_image === 1,
    hasFile: row.has_file === 1,
    hasYoutube: row.has_youtube === 1,
    attachments: row.attachments ? (JSON.parse(row.attachments) as StoredMessage['attachments']) : [],
    recipientName: row.recipient_name,
  };
}
