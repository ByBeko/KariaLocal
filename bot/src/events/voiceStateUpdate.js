import { e } from '../utils/emojis.js';
import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { handleTempVoice } from '../systems/tempvoice.js';
import { handleVoiceStats } from '../systems/stats.js';
import { handleMusicVoice } from '../systems/music.js';
import { formatDuration } from '../utils/time.js';

const joinedAt = new Map(); // "guild:user" -> kanala girdiği an

const stay = (key) => {
  const at = joinedAt.get(key);
  if (!at) return '';
  const ms = Date.now() - at;
  return ` • ${ms < 60_000 ? '1 dk’dan az' : formatDuration(ms)} kaldı`;
};

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    handleVoiceStats(oldState, newState);
    await handleTempVoice(oldState, newState);
    handleMusicVoice(oldState, newState);

    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    const key = `${newState.guild.id}:${member.id}`;

    let text;
    let color;
    if (oldState.channelId !== newState.channelId) {
      if (!oldState.channelId) {
        text = `${e('giris', '📥')} ${member} ${newState.channel} kanalına girdi`;
        color = 0x2ecc71;
      } else if (!newState.channelId) {
        text = `${e('cikis', '📤')} ${member} ${oldState.channel ?? `**${oldState.channelId}**`} kanalından çıktı${stay(key)}`;
        color = 0xe74c3c;
      } else {
        text = `${e('karistir', '🔀')} ${member} ${oldState.channel} → ${newState.channel}${stay(key)}`;
        color = 0x3498db;
      }
      if (newState.channelId) joinedAt.set(key, Date.now());
      else joinedAt.delete(key);
    } else if (!oldState.streaming && newState.streaming) {
      text = `${e('televizyon', '🖥️')} ${member} ${newState.channel} kanalında yayın açtı`;
      color = 0x9b59b6;
    } else if (!oldState.selfVideo && newState.selfVideo) {
      text = `${e('foto', '📷')} ${member} ${newState.channel} kanalında kamerasını açtı`;
      color = 0x9b59b6;
    } else {
      return; // kendi mikrofon/kulaklık değişimi loglanmaz; sunucu susturması auditlog.js'te
    }

    await sendLog(newState.guild, 'log_voice', {
      embeds: [new EmbedBuilder().setColor(color).setDescription(text).setFooter({ text: `ID: ${member.id}` }).setTimestamp()],
    });
  },
};
