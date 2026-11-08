import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
} from 'discord.js';
import { getSetting } from '../core/settings.js';
import { staffRoleIds } from '../utils/permissions.js';
import { PROFANITY_ROOTS, PROFANITY_WORDS } from '../utils/profanity.js';

const { Keyword, KeywordPreset, Spam } = AutoModerationRuleTriggerType;

export const RULE_NAMES = {
  turkish: 'Karia • Türkçe Küfür',
  preset: 'Karia • Küfür ve Argo',
  spam: 'Karia • Spam',
  links: 'Karia • Link ve Reklam',
  words: 'Karia • Yasaklı Kelimeler',
};

const INVITE_PATTERN = String.raw`(discord\.(gg|io|me|li)|discord(app)?\.com/invite|dsc\.gg|invite\.gg)/[\w-]+`;
const SHORT_LINK_PATTERN = String.raw`(bit\.ly|tinyurl\.com|cutt\.ly|shorturl\.at)/\S+`;

function actions(guild, customMessage) {
  const list = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage } }];
  const logId = getSetting(guild.id, 'log_ad');
  if (logId) list.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: logId } });
  return list;
}

/** Kural varsa günceller, yoksa açar. Spam ve hazır liste kuralından sunucuda yalnızca bir tane olabilir. */
async function upsert(guild, { name, triggerType, triggerMetadata, message }) {
  const rules = await guild.autoModerationRules.fetch({ cache: false });
  const single = triggerType === Spam || triggerType === KeywordPreset;
  const existing = rules.find((r) => (single ? r.triggerType === triggerType : r.name === name));
  const body = { enabled: true, actions: actions(guild, message), exemptRoles: staffRoleIds(guild.id), ...(triggerMetadata ? { triggerMetadata } : {}) };
  if (existing) return existing.edit(body);
  return guild.autoModerationRules.create({ name, eventType: AutoModerationRuleEventType.MessageSend, triggerType, ...body });
}

export async function setupProfanity(guild) {
  await upsert(guild, {
    name: RULE_NAMES.turkish,
    triggerType: Keyword,
    triggerMetadata: { keywordFilter: [...PROFANITY_WORDS, ...PROFANITY_ROOTS.map((root) => `${root}*`)] },
    message: 'Mesajın küfür içerdiği için engellendi.',
  });
  await upsert(guild, {
    name: RULE_NAMES.preset,
    triggerType: KeywordPreset,
    triggerMetadata: {
      presets: [AutoModerationRuleKeywordPresetType.Profanity, AutoModerationRuleKeywordPresetType.SexualContent, AutoModerationRuleKeywordPresetType.Slurs],
    },
    message: 'Mesajın küfür veya argo içerdiği için engellendi.',
  });
}

export const setupSpam = (guild) => upsert(guild, {
  name: RULE_NAMES.spam,
  triggerType: Spam,
  message: 'Mesajın spam olarak algılandığı için engellendi.',
});

export function setupLinks(guild) {
  // Sunucunun kendi özel adresi engellenmez
  const code = guild.vanityURLCode;
  return upsert(guild, {
    name: RULE_NAMES.links,
    triggerType: Keyword,
    triggerMetadata: { regexPatterns: [INVITE_PATTERN, SHORT_LINK_PATTERN], allowList: code ? [`*discord.gg/${code}*`, `*discord.com/invite/${code}*`] : [] },
    message: 'Mesajın reklam veya davet linki içerdiği için engellendi.',
  });
}

/** Kelimeyi yasaklı kelime kuralına ekler. Kelime zaten listedeyse false döner. */
export async function addKeyword(guild, word) {
  const rules = await guild.autoModerationRules.fetch({ cache: false });
  const current = rules.find((r) => r.name === RULE_NAMES.words)?.triggerMetadata.keywordFilter ?? [];
  if (current.includes(word)) return false;
  await upsert(guild, {
    name: RULE_NAMES.words,
    triggerType: Keyword,
    triggerMetadata: { keywordFilter: [...current, word] },
    message: 'Mesajın yasaklı bir kelime içerdiği için engellendi.',
  });
  return true;
}
