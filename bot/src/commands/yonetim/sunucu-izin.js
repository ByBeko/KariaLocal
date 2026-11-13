import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replyError, replySuccess } from '../../utils/embeds.js';
import { allowGuild, disallowGuild, allowedGuilds } from '../../core/allowedGuilds.js';

// Botun hangi sunuculara eklenebileceğini yalnızca Karia'nın sahibi belirler. Komut yalnızca Karia'da görünür.
const inviteLink = (clientId, guildId) =>
  `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=8&guild_id=${guildId}&disable_guild_select=true`;

export default {
  level: Level.OWNER,
  homeOnly: true,
  data: new SlashCommandBuilder()
    .setName('sunucu-izin')
    .setDescription('Botun eklenebileceği sunucuları yönetir (sadece sunucu sahibi).')
    .addSubcommand((s) =>
      s.setName('ekle').setDescription('Bir sunucuya izin ver ve davet linkini al')
        .addStringOption((o) => o.setName('sunucu_id').setDescription('Sunucu kimliği (ID)').setRequired(true))
        .addStringOption((o) => o.setName('not').setDescription('Hatırlatma notu (örn. sunucunun adı)')),
    )
    .addSubcommand((s) =>
      s.setName('kaldir').setDescription('İzni kaldır; bot o sunucudaysa çıkar')
        .addStringOption((o) => o.setName('sunucu_id').setDescription('Sunucu kimliği (ID)').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('İzinli sunucuları göster'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild, client, user } = interaction;
    if (user.id !== guild.ownerId) return replyError(interaction, 'Bu komutu sadece Karia sunucusunun sahibi kullanabilir.');
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const rows = allowedGuilds();
      const lines = rows.map((r) => {
        const g = client.guilds.cache.get(r.guild_id);
        return `• \`${r.guild_id}\` ${g ? `**${g.name}** (bot içeride, ${g.memberCount} üye)` : 'bot henüz eklenmedi'}${r.note ? ` • ${r.note}` : ''}`;
      });
      return replySuccess(interaction, rows.length ? `İzinli sunucular:\n${lines.join('\n')}` : 'Karia dışında izinli sunucu yok. `/sunucu-izin ekle` ile ekleyebilirsin.');
    }

    const id = interaction.options.getString('sunucu_id', true).trim();
    if (!/^\d{17,20}$/.test(id)) return replyError(interaction, 'Geçerli bir sunucu kimliği yaz (17-20 haneli sayı). Discord\'da sunucuya sağ tıklayıp "Sunucu ID\'sini Kopyala" ile alabilirsin.');
    if (id === guild.id) return replyError(interaction, 'Karia zaten her zaman izinli.');

    if (sub === 'ekle') {
      allowGuild(id, user.id, interaction.options.getString('not') ?? '');
      const inside = client.guilds.cache.get(id);
      return replySuccess(interaction, inside
        ? `**${inside.name}** artık izinli. Bot zaten orada.`
        : `\`${id}\` izinli listeye eklendi. Botu bu linkle o sunucuya ekle (sunucuda Sunucuyu Yönet yetkin olmalı):\n${inviteLink(client.application.id, id)}`);
    }

    const removed = disallowGuild(id);
    const inside = client.guilds.cache.get(id);
    if (inside) await inside.leave().catch(() => {});
    if (!removed && !inside) return replyError(interaction, 'Bu sunucu zaten izinli listede değil.');
    return replySuccess(interaction, `\`${id}\` izni kaldırıldı${inside ? `, bot **${inside.name}** sunucusundan çıktı` : ''}.`);
  },
};
