import type { AttachmentMeta, StoredMessage } from '../store/userStore.js';

export interface ApiEmbed {
  title?: string;
  description?: string;
  url?: string;
  type?: string;
  provider?: { name?: string };
  author?: { name?: string };
  fields?: Array<{ name?: string; value?: string }>;
}

export interface ApiAttachment {
  filename?: string;
  size?: number;
  content_type?: string;
}

export interface ApiSticker {
  name?: string;
}

export interface ApiSnapshotMessage {
  content?: string;
}

export interface ApiMessage {
  id: string;
  type?: number;
  channel_id?: string;
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  author?: { id?: string; username?: string; global_name?: string | null };
  attachments?: ApiAttachment[];
  embeds?: ApiEmbed[];
  sticker_items?: ApiSticker[];
  stickers?: ApiSticker[];
  message_snapshots?: Array<{ message?: ApiSnapshotMessage }>;
}

const STORED_TYPES = new Set([0, 19]);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>]+/i;
const YOUTUBE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:music\.)?(?:youtube\.com|youtu\.be)\b/i;

export function normalizeMessage(message: ApiMessage, channelId: string): StoredMessage | null {
  const type = message.type ?? 0;
  if (!STORED_TYPES.has(type)) return null;
  const content = message.content ?? '';
  const attachments = (message.attachments ?? []).map(mapAttachment);
  const embeds = message.embeds ?? [];
  const stickers = [...(message.sticker_items ?? []), ...(message.stickers ?? [])];
  const snapshots = message.message_snapshots ?? [];
  const parts = [
    content,
    ...attachments.map((attachment) => attachment.name),
    ...embeds.flatMap(embedParts),
    ...stickers.map((sticker) => sticker.name ?? ''),
    ...snapshots.map((snapshot) => snapshot.message?.content ?? ''),
  ].filter((part) => part.trim().length > 0);
  const searchText = parts.join('\n');
  const blob = [content, ...embeds.map((embed) => embed.url ?? ''), ...embeds.map((embed) => embed.description ?? '')].join(
    '\n',
  );
  const hasYoutube = YOUTUBE_PATTERN.test(searchText);
  const hasImage =
    attachments.some((attachment) => isImage(attachment)) || embeds.some((embed) => embed.type === 'image' || isImageUrl(embed.url));
  const hasFile = attachments.some((attachment) => !isImage(attachment));
  return {
    id: message.id,
    channelId: message.channel_id ?? channelId,
    authorId: message.author?.id ?? '',
    authorName: message.author?.global_name || message.author?.username || '알 수 없음',
    content,
    searchText,
    ts: message.timestamp ? Date.parse(message.timestamp) : snowflakeToMs(message.id),
    editedTs: message.edited_timestamp ? Date.parse(message.edited_timestamp) : null,
    hasLink: URL_PATTERN.test(blob) || embeds.some((embed) => Boolean(embed.url)),
    hasImage,
    hasFile,
    hasYoutube,
    attachments,
  };
}

function embedParts(embed: ApiEmbed): string[] {
  return [
    embed.title ?? '',
    embed.description ?? '',
    embed.url ?? '',
    embed.provider?.name ?? '',
    embed.author?.name ?? '',
    ...(embed.fields ?? []).flatMap((field) => [field.name ?? '', field.value ?? '']),
  ];
}

function mapAttachment(attachment: ApiAttachment): AttachmentMeta {
  return {
    name: attachment.filename ?? 'file',
    size: attachment.size ?? 0,
    contentType: attachment.content_type ?? null,
  };
}

function isImage(attachment: AttachmentMeta): boolean {
  if (attachment.contentType?.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXT.test(attachment.name);
}

function isImageUrl(url: string | undefined): boolean {
  return Boolean(url && IMAGE_EXT.test(url.split('?')[0] ?? url));
}

function snowflakeToMs(id: string): number {
  try {
    return Number((BigInt(id) >> 22n) + 1420070400000n);
  } catch {
    return Date.now();
  }
}
