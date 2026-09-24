import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  escapeMarkdown,
} from 'discord.js';
import type { APIComponentInMessageActionRow, APIMessageComponent } from 'discord.js';
import { makeSnippet } from '../../search/snippet.js';
import { PAGE_SIZE, type SearchHit } from '../../search/query.js';
import type { SessionFilters } from '../sessions.js';
import { COLOR, COPY } from './theme.js';

export interface SearchViewInput {
  sessionId: string;
  query: string;
  hits: SearchHit[];
  total: number;
  page: number;
  filters: SessionFilters;
  scoped: boolean;
  recipientName?: string;
  mode: 'keyword' | 'ai';
  syncingNote?: string;
}

export interface Rendered {
  components: APIMessageComponent[];
  flags: number;
  allowedMentions: { parse: [] };
}

export function ephemeralFlags(): number {
  return MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
}

export function renderSearch(input: SearchViewInput): Rendered {
  let budget = 160;
  let rendered = compose(input, budget);
  let stats = componentStats(rendered.components);
  while (stats.textLength > 4000 && budget > 40) {
    budget -= 20;
    rendered = compose(input, budget);
    stats = componentStats(rendered.components);
  }
  return rendered;
}

export function renderNotice(text: string, accent: number = COLOR.blurple): Rendered {
  const container = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return payload([container.toJSON()]);
}

export function renderNotLinked(): Rendered {
  const container = new ContainerBuilder()
    .setAccentColor(COLOR.blurple)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 🔍 그거\n${COPY.notLinked}`))
    .addActionRowComponents(buttonRow('gg:link:guide', COPY.linkButton));
  return payload([container.toJSON()]);
}

export function renderLinkGuide(): Rendered {
  const container = new ContainerBuilder()
    .setAccentColor(COLOR.yellow)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### 연동\n${COPY.risk}\n\n${COPY.tokenHelp}`),
    )
    .addActionRowComponents(buttonRow('gg:link:modal', COPY.tokenButton));
  return payload([container.toJSON()]);
}

export function renderUnlinkConfirm(): Rendered {
  const container = new ContainerBuilder()
    .setAccentColor(COLOR.red)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(COPY.unlinkAsk))
    .addActionRowComponents(buttonRow('gg:unlink:confirm', COPY.unlinkConfirm, ButtonStyle.Danger));
  return payload([container.toJSON()]);
}

export function renderResetConfirm(): Rendered {
  const container = new ContainerBuilder()
    .setAccentColor(COLOR.red)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(COPY.resetAsk))
    .addActionRowComponents(buttonRow('gg:reset:confirm', COPY.unlinkConfirm, ButtonStyle.Danger));
  return payload([container.toJSON()]);
}

function compose(input: SearchViewInput, budget: number): Rendered {
  const pages = Math.max(1, Math.ceil(input.total / PAGE_SIZE));
  const page = Math.min(input.page, pages - 1);
  const from = input.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(input.total, from + input.hits.length - 1);
  const scope = input.scoped && input.recipientName ? `${escapeMarkdown(input.recipientName)} · 이 대화` : '모아 둔 DM 전체';
  const title = input.mode === 'ai' ? '### 그거 · 의미' : '### 그거';
  const header = [
    title,
    `**${escapeMarkdown(input.query)}**`,
    `-# ${scope} · ${input.total.toLocaleString('ko-KR')}개 · ${from.toLocaleString('ko-KR')}–${to.toLocaleString('ko-KR')}`,
    input.syncingNote,
  ]
    .filter(Boolean)
    .join('\n');
  const container = new ContainerBuilder().setAccentColor(input.mode === 'ai' ? COLOR.yellow : COLOR.blurple);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(header, 500)));
  container.addSeparatorComponents(new SeparatorBuilder());
  input.hits.forEach((hit, index) => {
    if (index > 0) container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    const snippet = input.mode === 'ai' ? makeSnippet(hit, [], budget) : makeSnippet(hit, termsOf(input.query), budget);
    const when = `<t:${Math.floor(hit.ts / 1000)}:R>`;
    const where = input.scoped ? '' : `-# ${escapeMarkdown(hit.recipientName ?? 'DM')}\n`;
    const quoted = snippet
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const body = `${where}**${escapeMarkdown(hit.authorName)}** · ${when}\n${quoted}${metaLine(hit)}`;
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(body, 1800)))
      .setButtonAccessory(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('열기')
          .setURL(`https://discord.com/channels/@me/${hit.channelId}/${hit.id}`),
      );
    container.addSectionComponents(section);
  });
  container.addSeparatorComponents(new SeparatorBuilder());
  const foot = input.mode === 'ai' ? `-# ${COPY.aiFoot}` : '-# 최신순';
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(foot));
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`gg:page:${input.sessionId}:${page - 1}`)
        .setLabel('이전')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`gg:page:${input.sessionId}:stay`)
        .setLabel(`${page + 1} / ${pages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`gg:page:${input.sessionId}:${page + 1}`)
        .setLabel('다음')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page + 1 >= pages),
    ),
    authorRow(input),
    kindRow(input),
  ];
  return payload([container.toJSON(), ...rows.map((row) => row.toJSON())]);
}

function authorRow(input: SearchViewInput): ActionRowBuilder<StringSelectMenuBuilder> {
  const other = input.recipientName ?? '상대';
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`gg:filter:author:${input.sessionId}`)
      .setPlaceholder('보낸 사람')
      .addOptions(
        option('전체', 'all', input.filters.author === 'all'),
        option('나', 'me', input.filters.author === 'me'),
        option(other, 'other', input.filters.author === 'other'),
      ),
  );
}

function kindRow(input: SearchViewInput): ActionRowBuilder<StringSelectMenuBuilder> {
  const kinds: Array<[string, SessionFilters['kind']]> = [
    ['전체', 'all'],
    ['링크', 'link'],
    ['유튜브', 'youtube'],
    ['이미지', 'image'],
    ['파일', 'file'],
  ];
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`gg:filter:kind:${input.sessionId}`)
      .setPlaceholder('종류')
      .addOptions(kinds.map(([label, value]) => option(label, value, input.filters.kind === value))),
  );
}

function option(label: string, value: string, selected: boolean): StringSelectMenuOptionBuilder {
  return new StringSelectMenuOptionBuilder().setLabel(label.slice(0, 100)).setValue(value).setDefault(selected);
}

function buttonRow(customId: string, label: string, style = ButtonStyle.Primary): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style));
}

function metaLine(hit: SearchHit): string {
  const tags: string[] = [];
  if (hit.hasYoutube) tags.push('유튜브');
  else if (hit.hasLink) tags.push('링크');
  if (hit.hasImage) tags.push('이미지');
  if (hit.hasFile) tags.push('파일');
  if (hit.attachments.length > 0) tags.push(hit.attachments.map((attachment) => attachment.name).slice(0, 2).join(', '));
  const youtube = youtubeTitle(hit);
  if (youtube) tags.push(youtube);
  return tags.length > 0 ? `\n-# ${tags.join(' · ')}` : '';
}

function youtubeTitle(hit: SearchHit): string {
  if (!hit.hasYoutube) return '';
  const extra = hit.searchText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && line !== hit.content.trim() && !/^https?:\/\//i.test(line));
  return extra ? escapeMarkdown(extra).slice(0, 80) : '';
}

function termsOf(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function payload(components: APIMessageComponent[]): Rendered {
  return {
    components,
    flags: ephemeralFlags(),
    allowedMentions: { parse: [] },
  };
}

export function componentStats(components: unknown[]): { count: number; textLength: number } {
  let count = 0;
  let textLength = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { type?: number; content?: string; components?: unknown[]; accessory?: unknown };
    if (typeof record.type === 'number') count += 1;
    if (record.type === ComponentType.TextDisplay && typeof record.content === 'string') textLength += record.content.length;
    if (Array.isArray(record.components)) {
      for (const child of record.components) walk(child);
    }
    if (record.accessory) walk(record.accessory);
  };
  for (const component of components) walk(component);
  return { count, textLength };
}

export type { APIComponentInMessageActionRow };
