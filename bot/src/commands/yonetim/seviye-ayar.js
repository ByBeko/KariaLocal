import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { addReward, removeReward, getRewards, usersAtLeast, addXp, getProfile, resetUser, totalXpFor } from '../../systems/levels.js';
import { replySuccess } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { sendLog } from '../../utils/logger.js';

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('seviye-ayar')
    .setDescription('Seviye ödül rolleri ve XP yönetimi.')
    .addSubcommand((s) =>
      s
        .setName('odul-ekle')
        .setDescription('Bir seviyeye ulaşanlara rol verilsin (o seviyedekilere hemen verilir)')
        .addIntegerOption((o) => o.setName('seviye').setDescription('Seviye').setMinValue(1).setMaxValue(500).setRequired(true))
        .addRoleOption((o) => o.setName('rol').setDescription('Verilecek rol').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('odul-sil')
        .setDescription('Seviye ödülünü kaldırır (kimseden rol alınmaz)')
        .addRoleOption((o) => o.setName('rol').setDescription('Ödül rolü').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('xp')
        .setDescription('Bir üyeye XP ekler ya da çıkarır (eksi değer)')
        .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
        .addIntegerOption((o) => o.setName('miktar').setDescription('Örn. 500 ya da -200').setMinValue(-1_000_000).setMaxValue(1_000_000).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('seviye-ver')
        .setDescription('Bir üyenin seviyesini doğrudan ayarlar')
        .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
        .addIntegerOption((o) => o.setName('seviye').setDescription('Yeni seviye').setMinValue(0).setMaxValue(500).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('sifirla')
        .setDescription("Bir üyenin XP'sini sıfırlar")
        .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();

    if (sub === 'odul-ekle') {
      const level = interaction.options.getInteger('seviye', true);
      const role = interaction.options.getRole('rol', true);
      if (role.managed || role.id === guild.id) throw new UserError('Bu rol verilemez (bot rolü ya da @everyone).');
      if (!role.editable) throw new UserError('Bu rol benim rolümden yüksekte. Bot rolünü rol listesinde yukarı taşı.');
      addReward(guild.id, level, role.id);
      await interaction.deferReply();
      let given = 0;
      for (const userId of usersAtLeast(guild.id, level)) {
        const member = guild.members.cache.get(userId);
        if (member && !member.roles.cache.has(role.id)) {
          if (await member.roles.add(role, `Seviye ödülü (seviye ${level})`).then(() => true).catch(() => false)) given++;
        }
      }
      return replySuccess(interaction, `**Seviye ${level}** ödülü: ${role}${given ? `\nŞu an bu seviyede olan **${given}** üyeye rol verildi.` : ''}`);
    }

    if (sub === 'odul-sil') {
      const role = interaction.options.getRole('rol', true);
      if (!removeReward(guild.id, role.id)) throw new UserError('Bu rol bir seviye ödülü değil.');
      const left = getRewards(guild.id).map((r) => `Seviye ${r.level} → <@&${r.roleId}>`).join('\n');
      return replySuccess(interaction, `${role} artık seviye ödülü değil.${left ? `\n\n**Kalan ödüller:**\n${left}` : ''}`);
    }

    const user = interaction.options.getUser('kullanici', true);
    if (user.bot) throw new UserError('Botların seviyesi olmaz.');

    if (sub === 'sifirla') {
      const before = getProfile(guild.id, user.id);
      resetUser(guild.id, user.id);
      await sendLog(guild, 'log_level', {
        content: `${e('cop', '🧹')} <@${user.id}> XP'si sıfırlandı (seviye ${before.level}, ${before.xp} XP) • Yapan: ${interaction.user}`,
      });
      return replySuccess(interaction, `${user} XP'si sıfırlandı (önceden seviye ${before.level}, ${before.xp} XP). Ödül rolleri geri alınmadı.`);
    }

    let amount = interaction.options.getInteger('miktar');
    if (sub === 'seviye-ver') amount = totalXpFor(interaction.options.getInteger('seviye', true)) - getProfile(guild.id, user.id).xp;
    const r = await addXp(guild, user.id, amount, { source: 'yetkili', byId: interaction.user.id });
    await replySuccess(interaction, `${user}: ${amount >= 0 ? '+' : ''}${amount} XP → **Seviye ${r.level}** (${r.xp} XP)`);
  },
};
