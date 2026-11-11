import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { rankCard } from '../../systems/cards.js';
import { getProfile, getRewards, progressBar, rankEmoji, totalXpFor } from '../../systems/levels.js';
import { kariaEmbed, label } from '../../utils/embeds.js';

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
      const lines = rewards.map((r) => `${rankEmoji(r.level)} **Seviye ${r.level}** → <@&${r.roleId}> (${totalXpFor(r.level).toLocaleString('tr-TR')} XP)`);
      return interaction.reply({
        embeds: [
          kariaEmbed(interaction.client, 'Seviye Ödülleri')
            .setTitle(`${rewards.length} ödül rolü`)
            .setThumbnail(guild.iconURL({ size: 256 }))
            .setDescription(lines.join('\n') || 'Henüz ödül rolü eklenmedi. Yöneticiler `/seviye-ayar odul-ekle` ile ekleyebilir.')
            .addFields(
              { name: label('mesaj', '💬', 'Mesaj'), value: 'Dakikada bir\n**10-20** XP', inline: true },
              { name: label('mikrofon', '🎙️', 'Ses'), value: 'En az 2 kişiyken\ndakikada **3** XP', inline: true },
              { name: label('kumsaati', '⏱️', 'Sınır'), value: 'Seste günde\nen çok **600** XP', inline: true },
            ),
        ],
        allowedMentions: { parse: [] },
      });
    }

    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    if (user.bot) return interaction.reply({ embeds: [kariaEmbed(interaction.client, 'Seviye Kartı').setDescription(`Botların seviyesi olmaz. ${e('bot', '🤖')}`)] });
    const p = getProfile(guild.id, user.id);
    const next = getRewards(guild.id).find((r) => r.level > p.level);
    const member = guild.members.cache.get(user.id);
    const nextRole = next && guild.roles.cache.get(next.roleId);
    const remaining = next ? totalXpFor(next.level) - p.xp : 0;

    const embed = kariaEmbed(interaction.client, 'Seviye Kartı', { icon: user.displayAvatarURL() })
      .setTitle(member?.displayName ?? user.username)
      .addFields(
        { name: label('yildiz', '⭐', 'Seviye'), value: `**${p.level}**\n${p.current}/${p.needed} XP`, inline: true },
        { name: label('kupa', '🏆', 'Sıra'), value: p.rank ? `**#${p.rank}**\n${p.xp.toLocaleString('tr-TR')} XP` : '—', inline: true },
        { name: label('hedef', '🎯', 'Sıradaki ödül'), value: next ? `<@&${next.roleId}>\n**${remaining.toLocaleString('tr-TR')}** XP kaldı` : 'Hepsi alındı', inline: true },
      );

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
      return await interaction.reply({ embeds: [embed.setImage('attachment://seviye.png')], files: [file], allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('[Seviye kartı]', error.message); // resim çizilemezse yazılı karta düş
    }

    embed
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields({ name: label('istatistik', '📈', 'İlerleme'), value: `${progressBar(p.current, p.needed)} %${Math.floor((p.current / p.needed) * 100)}` });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
