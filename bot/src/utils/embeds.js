import { EmbedBuilder, MessageFlags } from 'discord.js';
import { e } from './emojis.js';
import config from '../config.js';

export const COLORS = {
  brand: config.brand.color,
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xf1c40f,
};

export const brandEmbed = () => new EmbedBuilder().setColor(COLORS.brand);

export const successEmbed = (text) => new EmbedBuilder().setColor(COLORS.success).setDescription(`${e('onayli', '✅')} ${text}`);

export const errorEmbed = (text) => new EmbedBuilder().setColor(COLORS.error).setDescription(`${e('carpi', '❌')} ${text}`);

/** Etkileşime durumu ne olursa olsun (reply/defer edilmiş) güvenle cevap verir. */
export async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const { flags, ...rest } = payload;
    return interaction.deferred && !interaction.replied ? interaction.editReply(rest) : interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

export const replyError = (interaction, text) =>
  respond(interaction, { embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

export const replySuccess = (interaction, text, ephemeral = true) =>
  respond(interaction, { embeds: [successEmbed(text)], flags: ephemeral ? MessageFlags.Ephemeral : undefined });
