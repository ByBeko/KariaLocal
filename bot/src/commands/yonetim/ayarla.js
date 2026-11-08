import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { SETTINGS, settingsOfType, setSetting, formatSetting } from '../../core/settings.js';
import { replyError, replySuccess } from '../../utils/embeds.js';

const choices = (type) => settingsOfType(type).map(([key, s]) => ({ name: s.label.slice(0, 100), value: key }));

export const KIND_CHECK = {
  text: (c) => c.isTextBased() && !c.isVoiceBased(),
  voice: (c) => c.type === ChannelType.GuildVoice,
  category: (c) => c.type === ChannelType.GuildCategory,
};
export const KIND_NAME = { text: 'yazı kanalı', voice: 'ses kanalı', category: 'kategori' };

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('ayarla')
    .setDescription('Bot ayarlarını değiştirir. Değer boş bırakılırsa ayar sıfırlanır.')
    .addSubcommand((s) =>
      s.setName('kanal').setDescription('Bir kanal ayarı')
        .addStringOption((o) => o.setName('ayar').setDescription('Hangi ayar?').setRequired(true).addChoices(...choices('channel')))
        .addChannelOption((o) => o.setName('kanal').setDescription('Kanal (boş = sıfırla)')),
    )
    .addSubcommand((s) =>
      s.setName('rol').setDescription('Bir rol ayarı')
        .addStringOption((o) => o.setName('ayar').setDescription('Hangi ayar?').setRequired(true).addChoices(...choices('role')))
        .addRoleOption((o) => o.setName('rol').setDescription('Rol (boş = sıfırla)')),
    )
    .addSubcommand((s) =>
      s.setName('ac-kapat').setDescription('Bir özelliği aç ya da kapat')
        .addStringOption((o) => o.setName('ayar').setDescription('Hangi özellik?').setRequired(true).addChoices(...choices('bool')))
        .addBooleanOption((o) => o.setName('durum').setDescription('Açık mı?').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('deger').setDescription('Sayı veya yazı ayarı')
        .addStringOption((o) =>
          o.setName('ayar').setDescription('Hangi ayar?').setRequired(true).addChoices(...choices('number'), ...choices('text')),
        )
        .addStringOption((o) => o.setName('deger').setDescription('Yeni değer (boş = varsayılana dön)').setMaxLength(1000)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const key = interaction.options.getString('ayar', true);
    const def = SETTINGS[key];
    const guildId = interaction.guild.id;
    let value;

    if (sub === 'kanal') {
      const channel = interaction.options.getChannel('kanal');
      if (channel && !KIND_CHECK[def.kind](channel)) {
        return replyError(interaction, `Bu ayar için bir **${KIND_NAME[def.kind]}** seçmelisin.`);
      }
      value = channel?.id ?? null;
    } else if (sub === 'rol') {
      const role = interaction.options.getRole('rol');
      if (role?.managed) return replyError(interaction, 'Bot/entegrasyon rolleri seçilemez.');
      if (role && ['member_role', 'bot_role', 'jail_role'].includes(key) && !role.editable) {
        return replyError(interaction, 'Bu rolü veremem çünkü benim rolümden yüksekte. Bot rolünü yukarı taşı.');
      }
      value = role?.id ?? null;
    } else if (sub === 'ac-kapat') {
      value = interaction.options.getBoolean('durum', true);
    } else {
      const raw = interaction.options.getString('deger');
      if (raw !== null && def.type === 'number') {
        value = Number(raw);
        if (!Number.isInteger(value) || value < 0) return replyError(interaction, 'Pozitif bir tam sayı girmelisin.');
      } else {
        value = raw;
      }
    }

    setSetting(guildId, key, value);
    await replySuccess(interaction, `**${def.label}** → ${formatSetting(guildId, key)}`);
  },
};
