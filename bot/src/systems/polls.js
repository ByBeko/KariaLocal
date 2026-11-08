// Butonlu, süreli anketler. Üye tek oy verir, başka seçeneğe basınca oyu değişir, aynı seçeneğe basınca geri alınır.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db } from '../core/database.js';
import { e } from '../utils/emojis.js';
import { ruleText, fit } from '../utils/style.js';
import { relativeTime } from '../utils/time.js';
import { notifyRole } from '../utils/notifyRole.js';

const q = {
  insert: db.prepare('INSERT INTO polls (message_id, guild_id, channel_id, host_id, question, options, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM polls WHERE message_id=?'),
  votes: db.prepare('UPDATE polls SET votes=? WHERE message_id=?'),
  end: db.prepare('UPDATE polls SET ended=1 WHERE message_id=?'),
  due: db.prepare('SELECT * FROM polls WHERE ended=0 AND ends_at<=?'),
};

function view({ question, options, votes, ends_at: endsAt, host_id: hostId }, ended = false) {
  const list = JSON.parse(options);
  const counts = list.map(() => 0);
  for (const choice of Object.values(JSON.parse(votes))) counts[choice]++;
  const total = counts.reduce((a, b) => a + b, 0);

  const body = list
    .map((option, i) => {
      const share = total ? Math.round((counts[i] / total) * 100) : 0;
      const filled = Math.round(share / 10);
      return `**${i + 1}.** ${option}\n\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\` %${share} • ${counts[i]} oy`;
    })
    .join('\n');
  const content = ruleText({
    icon: e('anket', '📊'),
    title: ended ? 'Anket Sonucu' : 'Anket',
    intro: `**${question}**`,
    sections: [{ icon: e('pano', '📋'), title: 'Seçenekler', body }],
    note: `${ended ? 'Bitti' : 'Bitiş'}: ${relativeTime(endsAt)} • Toplam ${total} oy • Açan: <@${hostId}>`,
  });
  const buttons = list.map((option, i) =>
    new ButtonBuilder().setCustomId(`anket:oy:${i}`).setLabel(`${i + 1}. ${option}`.slice(0, 80)).setStyle(ButtonStyle.Secondary).setDisabled(ended),
  );
  return { content: fit(content), components: [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}

export async function createPoll({ channel, hostId, question, options, duration }) {
  const draft = { question, options: JSON.stringify(options), votes: '{}', ends_at: Date.now() + duration, host_id: hostId };
  const payload = view(draft);
  const ping = notifyRole(channel.guild, 'Anket Bildirimi');
  // Etiket yalnızca ilk mesajda: oy verildikçe yenilenen metinde tekrar bildirim gitmez
  const message = await channel.send({ ...payload, content: fit(`${ping.mention}\n${payload.content}`.trim()), allowedMentions: ping.allowedMentions });
  q.insert.run(message.id, channel.guild.id, channel.id, hostId, question, draft.options, draft.ends_at);
  return message;
}

/** Oyu işler. Anket yoksa/bittiyse null döner. */
export function castVote(messageId, userId, choice) {
  const poll = q.get.get(messageId);
  if (!poll || poll.ended || !JSON.parse(poll.options)[choice]) return null;
  const votes = JSON.parse(poll.votes);
  const removed = votes[userId] === choice;
  if (removed) delete votes[userId];
  else votes[userId] = choice;
  const updated = { ...poll, votes: JSON.stringify(votes) };
  q.votes.run(updated.votes, messageId);
  return { removed, view: view(updated) };
}

export async function endDuePolls(client, now) {
  for (const poll of q.due.all(now)) {
    q.end.run(poll.message_id);
    const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(poll.message_id).catch(() => null);
    await message?.edit(view(poll, true)).catch((error) => console.error('[Anket bitir]', error.message));
  }
}
