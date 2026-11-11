// Seviye atlama ve rol kazanma coin ödülleri. Her ödül üye başına bir kez verilir: rol alıp bırakarak kasılamaz.
import { db } from '../core/database.js';
import { getSetting } from '../core/settings.js';
import { addMoney, getBalance, setMoney } from './economy.js';
import { sendLog } from '../utils/logger.js';
import { brandEmbed } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';

export const levelUpCoins = (level) => level * 5;

const BOOST_ROLE = '1568654095991185488';
const BOOST_MIN_DAYS = 7; // Bu süre dolmadan çekilen takviyede ödülün 3/4'ü geri alınır
const DAY = 86_400_000;

// Emek isteyen seviye rolleri en yüksek ödülü verir; rozetler onun altında kalır
export const ROLE_COINS = [
  { id: '1569355122927075601', name: 'Köylü', coins: 250 },
  { id: '1569355128102977567', name: 'Zanaatkâr', coins: 500 },
  { id: '1569355136306909225', name: 'Tüccar', coins: 1_500 },
  { id: '1569355150529667165', name: 'Soylu', coins: 4_000 },
  { id: '1569434231564668978', name: 'Lord', coins: 8_000 },
  { id: '1569434235192868928', name: 'İmparator', coins: 15_000 },
  { id: '1568323512693821650', name: 'Hata Avcısı', coins: 1_000 },
  { id: '1568323512693821649', name: 'Erken Destekçi', coins: 1_500 },
  { id: BOOST_ROLE, name: 'Takviye', coins: 2_500 },
  { id: '1569468546713526443', name: 'Prime', coins: 3_000 },
];
export const roleCoinAmount = (roleId) => ROLE_COINS.find((r) => r.id === roleId)?.coins ?? 0;

const skipped = new Set(); // Yalnızca rol hediye edilen durumlarda bir sonraki rol coini atlanır
export const skipRoleCoinOnce = (guildId, userId, roleId) => skipped.add(`${guildId}:${userId}:${roleId}`);

const claim = db.prepare('INSERT OR IGNORE INTO coin_rewards (guild_id, user_id, reward, coins, at) VALUES (?, ?, ?, ?, ?)');
const claimed = db.prepare('SELECT coins FROM coin_rewards WHERE guild_id=? AND user_id=? AND reward=?');

/** Aynı ödülü aynı üyeye ikinci kez vermez; verilen miktarı döner. */
export function grantOnce(guildId, userId, reward, coins) {
  if (!Number(claim.run(guildId, userId, reward, coins, Date.now()).changes)) return 0;
  addMoney(guildId, userId, coins);
  return coins;
}

/** Yeni ulaşılan her seviye için ödül verir, verilen toplamı döner. */
export function grantLevelCoins(guildId, userId, fromLevel, toLevel) {
  if (!getSetting(guildId, 'economy_enabled')) return 0;
  let total = 0;
  for (let level = fromLevel + 1; level <= toLevel; level++) total += grantOnce(guildId, userId, `level:${level}`, levelUpCoins(level));
  return total;
}

/** Takviye 7 gün dolmadan çekildiyse ödülün 3/4'ü alınır; bakiye yetmezse sıfıra iner. */
async function clawbackBoost(oldMember, newMember) {
  const { guild, user } = newMember;
  if (!oldMember.roles.cache.has(BOOST_ROLE) || newMember.roles.cache.has(BOOST_ROLE)) return;
  const since = oldMember.premiumSinceTimestamp;
  if (!since || Date.now() - since >= BOOST_MIN_DAYS * DAY) return;
  const paid = Number(claimed.get(guild.id, user.id, `role:${BOOST_ROLE}`)?.coins ?? 0);
  const amount = Math.floor((paid * 3) / 4);
  if (amount <= 0 || !Number(claim.run(guild.id, user.id, `clawback:${BOOST_ROLE}`, -amount, Date.now()).changes)) return;
  const balance = getBalance(guild.id, user.id);
  const taken = Math.min(balance, amount);
  setMoney(guild.id, user.id, balance - taken);
  await sendLog(guild, 'log_level', { content: `${e('coin', '🪙')} <@${user.id}> takviyesini ${BOOST_MIN_DAYS} gün dolmadan çekti, **${taken.toLocaleString('tr-TR')}** coin geri alındı.` });
}

/** Üye ödüllü bir rol aldıysa coin verir ve duyurur. */
export async function grantRoleCoins(oldMember, newMember) {
  const { guild, user } = newMember;
  if (user.bot || !getSetting(guild.id, 'economy_enabled')) return;
  await clawbackBoost(oldMember, newMember);
  for (const reward of ROLE_COINS) {
    if (oldMember.roles.cache.has(reward.id) || !newMember.roles.cache.has(reward.id)) continue;
    if (skipped.delete(`${guild.id}:${user.id}:${reward.id}`)) continue;
    const coins = grantOnce(guild.id, user.id, `role:${reward.id}`, reward.coins);
    if (!coins) continue;
    await sendLog(guild, 'log_level', { content: `${e('coin', '🪙')} <@${user.id}> **${reward.name}** rolüyle **${coins.toLocaleString('tr-TR')}** coin kazandı.` });
    if (!getSetting(guild.id, 'level_announce')) continue;
    const channel = guild.channels.cache.get(getSetting(guild.id, 'level_channel'));
    if (!channel?.isTextBased()) continue;
    const embed = brandEmbed().setColor(0xf1c40f).setDescription(`${e('coin', '🪙')} ${newMember} **${reward.name}** rolünü aldı ve **${coins.toLocaleString('tr-TR')}** coin kazandı!`);
    await channel.send({ content: `${newMember}`, embeds: [embed], allowedMentions: { users: [user.id] } }).catch(() => {});
  }
}
