// Türkçe küfür listesi. Bot filtresi, /durumtara ve Discord AutoMod kuralı aynı listeyi kullanır.
// "sık", "pic", "got" gibi normal kelimelerle çakışan yazımlar bilerek yok.
export const PROFANITY_WORDS = [
  'amk', 'aq', 'amq', 'ammk', 'mk', 'oç', 'piç', 'sik', 'sikim', 'sikik', 'sikiş', 'sikis', 'sikeyim', 'sikerim', 'siktir',
  'orospu', 'yarrak', 'yarak', 'amına', 'amina', 'ananı', 'anani', 'ananızı', 'amcık', 'amcik', 'pezevenk', 'kahpe', 'yavşak', 'yavsak',
  'gavat', 'göt', 'götveren', 'gotveren', 'ibne',
];

// Bu köklerle başlayan her kelime küfür sayılır (siktirgit, orospuçocuğu...).
export const PROFANITY_ROOTS = [
  'orospu', 'orosbu', 'oruspu', 'siktir', 'sıktır', 'sikey', 'siker', 'yarrak', 'amına', 'amina', 'amcık', 'amcik', 'pezeven', 'kahpe', 'yavşa', 'yavsa', 'götver', 'gotver',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

function tokens(text) {
  return text
    .replace(/<[^>]*>|https?:\/\/\S+/g, ' ') // etiket, özel emoji ve linkler sayılmaz
    .toLocaleLowerCase('tr')
    .replace(/[013457@$]/g, (c) => LEET[c])
    .replace(/(?<![\p{L}\p{N}])(?:\p{L}[.\-_ ]){2,}\p{L}(?![\p{L}\p{N}])/gu, (m) => m.replace(/[.\-_ ]/g, '')) // a.m.k, s i k
    .replace(/(\p{L})\1{2,}/gu, '$1') // siiiktir
    .replace(/(?<!\p{L})sik sik(?!\p{L})/gu, ' ') // Türkçe karakter kullanmadan yazılan "sık sık"
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Metinde küfür varsa true döner. */
export function hasProfanity(text) {
  return tokens(text ?? '').some((word) => PROFANITY_WORDS.includes(word) || PROFANITY_ROOTS.some((root) => word.startsWith(root)));
}
