import { escapeMarkdown } from 'discord.js';
import type { StoredMessage } from '../store/userStore.js';

const EXCERPT_LENGTH = 160;
const MAX_LINES = 3;
const LONG_URL = 80;

export function makeSnippet(message: Pick<StoredMessage, 'content' | 'searchText' | 'attachments'>, terms: string[], budget = EXCERPT_LENGTH): string {
  const source = pickSource(message, terms);
  const excerpt = excerptAround(source.text, terms, budget);
  const highlighted = highlight(excerpt, terms);
  return source.prefix ? `${source.prefix} ${highlighted}` : highlighted;
}

function pickSource(
  message: Pick<StoredMessage, 'content' | 'searchText' | 'attachments'>,
  terms: string[],
): { text: string; prefix: string } {
  if (findTerm(message.content, terms) >= 0) return { text: message.content, prefix: '' };
  for (const attachment of message.attachments) {
    if (findTerm(attachment.name, terms) >= 0) return { text: attachment.name, prefix: '📎' };
  }
  return { text: message.searchText, prefix: '🔗' };
}

function excerptAround(text: string, terms: string[], budget: number): string {
  const flat = text.replace(/\r\n/g, '\n');
  const index = findTerm(flat, terms);
  if (index < 0) return limitLines(trimWindow(flat, 0, Math.min(flat.length, budget)), budget);
  const start = Math.max(0, index - Math.floor(budget / 2));
  const end = Math.min(flat.length, start + budget);
  return limitLines(trimWindow(flat, start, end), budget);
}

function trimWindow(text: string, start: number, end: number): string {
  let slice = text.slice(start, end);
  if (start > 0) slice = `…${slice}`;
  if (end < text.length) slice = `${slice}…`;
  return slice;
}

function limitLines(text: string, budget: number): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_LINES && text.length <= budget + 2) return text;
  const kept = lines.slice(0, MAX_LINES).join('\n');
  const clipped = kept.length > budget ? `${kept.slice(0, budget)}…` : lines.length > MAX_LINES ? `${kept}…` : kept;
  return clipped;
}

function highlight(excerpt: string, terms: string[]): string {
  const pattern = /https?:\/\/[^\s<>]+/gi;
  let cursor = 0;
  let out = '';
  for (const match of excerpt.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += boldTerms(escapeMarkdown(excerpt.slice(cursor, index)), terms);
    out += formatUrl(match[0]);
    cursor = index + match[0].length;
  }
  out += boldTerms(escapeMarkdown(excerpt.slice(cursor)), terms);
  return out;
}

function formatUrl(url: string): string {
  if (url.length <= LONG_URL) return `<${url}>`;
  const head = url.slice(0, 40);
  const tail = url.slice(-20);
  return `\`${head}…${tail}\``;
}

function boldTerms(text: string, terms: string[]): string {
  let result = text;
  for (const term of terms) {
    if ([...term].length === 0) continue;
    const escaped = escapeRegExp(term);
    result = result.replace(new RegExp(escaped, 'gi'), (found) => `**${found}**`);
  }
  return result;
}

function findTerm(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
