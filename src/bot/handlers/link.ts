import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { encryptSecret, tokenKey } from '../../security/crypto.js';
import { TokenInvalidError } from '../../discord/userApi.js';
import { isAllowed } from '../guard.js';
import type { AppContext } from '../context.js';
import { renderLinkGuide, renderNotice } from '../ui/results.js';
import { deniedView, errorView } from '../ui/states.js';
import { COLOR, COPY } from '../ui/theme.js';

export function validateTokenShape(token: string): string | null {
  const value = token.trim();
  if (/^bot\s+/i.test(value)) return '봇 토큰은 쓸 수 없어요. 계정 토큰을 넣어 주세요.';
  if (value.length < 50 || value.length > 100) return '토큰 길이가 올바르지 않아요.';
  if (!/^[\w.-]+$/.test(value) || value.split('.').length < 3) return '토큰 형식이 올바르지 않아요.';
  return null;
}

export async function handleLink(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  await interaction.reply(renderLinkGuide());
}

export async function handleLinkButton(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  if (interaction.customId === 'gg:link:guide') {
    await interaction.update(renderLinkGuide());
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId('gg:link:submit')
    .setTitle('계정 토큰')
    .addLabelComponents(
      new LabelBuilder().setLabel('계정 토큰').setDescription('채팅에는 남지 않아요.').setTextInputComponent(
        new TextInputBuilder().setCustomId('token').setStyle(TextInputStyle.Short).setMinLength(50).setMaxLength(100).setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleLinkModal(interaction: ModalSubmitInteraction, ctx: AppContext): Promise<void> {
  if (!isAllowed(ctx.config, interaction.user.id)) {
    await interaction.reply(deniedView());
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const token = interaction.fields.getTextInputValue('token').trim();
  const shape = validateTokenShape(token);
  if (shape) {
    await interaction.editReply(renderNotice(shape, COLOR.red));
    return;
  }
  try {
    const me = await ctx.api.getMe(token);
    if (me.id !== interaction.user.id) {
      await interaction.editReply(renderNotice('이 토큰은 지금 명령어를 쓴 계정이 아니에요.', COLOR.red));
      return;
    }
    const encoded = encryptSecret(tokenKey(ctx.config.masterKey), token, interaction.user.id);
    ctx.registry.upsert({
      userId: interaction.user.id,
      username: me.global_name || me.username,
      tokenEnc: encoded,
      status: 'syncing',
    });
    ctx.queue.enqueue(`backfill:${interaction.user.id}`, () => ctx.syncer.backfillUser(interaction.user.id));
    ctx.semantic.kick(interaction.user.id);
    await interaction.editReply(renderNotice(`### 연동\n${COPY.linked}`, COLOR.green));
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 14 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      const user = ctx.registry.get(interaction.user.id);
      if (!user || user.status === 'ready' || user.status === 'error' || user.status === 'token_invalid') {
        clearInterval(timer);
      }
      const progress = user?.progress;
      const line = progress
        ? `대화 ${progress.channelsDone}/${progress.channelsTotal} · 메시지 ${progress.messages.toLocaleString('ko-KR')}개`
        : '시작하는 중이에요.';
      void interaction.editReply(renderNotice(`### 연동\n${COPY.linked}\n-# ${line}`, COLOR.green)).catch(() => clearInterval(timer));
    }, 10_000);
    timer.unref?.();
  } catch (error) {
    if (error instanceof TokenInvalidError) {
      await interaction.editReply(renderNotice('토큰이 거부됐어요. 다시 복사해서 넣어 주세요.', COLOR.red));
      return;
    }
    ctx.log.error('연동에 실패했어요.', { error });
    await interaction.editReply(errorView());
  }
}
