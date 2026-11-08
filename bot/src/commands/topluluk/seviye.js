import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { rankCard } from '../../systems/cards.js';
import { getProfile, getRewards, progressBar, totalXpFor } from '../../systems/levels.js';
import { brandEmbed } from '../../utils/embeds.js';

export default {
  aliases: ['rank', 'level', 'lvl'],
  defaultSub: 'kart',
  data: new SlashCommandBuilder()
    .setName('seviye')
    .setDescription('Seviye (rank) kartı ya da seviye ödülleri.')
    .addSubcommand((s) =>
      s
        .setName('kart')
        .setDescription('Seviyeni ve XP ilerlemeni gösterir')
        .addUserOption((o) => o.setName('kullanici').setDescription('Başkasınınkine bak')),
    )
    .addSubcommand((s) => s.setName('oduller').setDescription('Hangi seviyede hangi rol kazanılır')),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand(false) ?? 'kart';

    if (sub === 'oduller') {
      const rewards = getRewards(guild.id);
      const lines = rewards.map((r) => `**Seviye ${r.level}** → <@&${r.roleId}>`);
      return interaction.reply({
        embeds: [
          brandEmbed()
            .setTitle(`${e('hediye', '🎁')} Seviye ödülleri`)
            .setDescription(lines.join('\n') || 'Henüz ödül rolü eklenmedi. Yöneticiler `/seviye-ayar odul-ekle` ile ekleyebilir.')
            .setFooter({ text: 'Mesaj (dakikada bir 10-20 XP) ve ses (en az 2 kişiyken dakikada 3 XP) ile XP kazanılır.' }),
        ],
        allowedMentions: { parse: [] },
      });
    }

    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    if (user.bot) return interaction.reply({ content: `Botların seviyesi olmaz. ${e('bot', '🤖')}` });
    const p = getProfile(guild.id, user.id);
    const next = getRewards(guild.id).find((r) => r.level > p.level);
    const member = guild.members.cache.get(user.id);
    const nextRole = next && guild.roles.cache.get(next.roleId);

    try {
      const png = await rankCard({
        name: member?.displayName ?? user.globalName ?? user.username,
        tag: user.username,
        avatarURL: (member ?? user).displayAvatarURL({ extension: 'png', size: 256 }),
        color: member?.displayHexColor,
        level: p.level,
        rank: p.rank,
        xp: p.xp,
        current: p.current,
        needed: p.needed,
        nextReward: nextRole ? `@${nextRole.name} (seviye ${next.level})` : null,
      });
      const file = new AttachmentBuilder(png, { name: 'seviye.png' });
      const remaining = next ? totalXpFor(next.level) - p.xp : 0;
      const embed = brandEmbed()
        .setImage('attachment://seviye.png')
        .setFooter({
          text: next
            ? `Sıradaki ödüle ${remaining.toLocaleString('tr-TR')} XP kaldı • Mesaj ve sesle XP kazanırsın`
            : 'Mesaj yazarak ve seste vakit geçirerek XP kazanırsın',
        });
      if (member?.displayHexColor && member.displayHexColor !== '#000000') embed.setColor(member.displayHexColor);
      return await interaction.reply({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('[Seviye kartı]', error.message); // resim çizilemezse yazılı karta düş
    }

    const embed = brandEmbed()
      .setAuthor({ name: `${member?.displayName ?? user.username} • Seviye kartı`, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Seviye', value: `**${p.level}**`, inline: true },
        { name: 'Sıra', value: p.rank ? `**#${p.rank}**` : '—', inline: true },
        { name: 'Toplam XP', value: p.xp.toLocaleString('tr-TR'), inline: true },
        {
          name: `İlerleme • ${p.current}/${p.needed} XP`,
          value: `${progressBar(p.current, p.needed)} %${Math.floor((p.current / p.needed) * 100)}`,
        },
      );
    if (next) {
      const remaining = totalXpFor(next.level) - p.xp;
      embed.addFields({ name: 'Sıradaki ödül', value: `<@&${next.roleId}> • seviye ${next.level} (${remaining.toLocaleString('tr-TR')} XP kaldı)` });
    }
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
