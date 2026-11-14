// Karia sabit ayarları. Kanal/rol gibi sunucu ayarları bu dosyada DEĞİL,
// Discord'da /ayarla komutuyla yapılır ve veritabanına kaydedilir.

export default {
  // Mesajla komut kullanımı: "kl ban @kişi sebep"
  prefix: 'kl',
  // Hepsi aynı işi yapar: "kl ban", "k ban", "kari ban". Komut olmayan bir şey yazılırsa yapay zeka sohbet eder: "kari naber"
  prefixes: ['kari', 'kl', 'k'],

  // Yapay zeka: Ollama üzerinde çalışan Qwen2.5 (yerel, ücretsiz)
  ai: {
    url: process.env.AI_URL || 'http://127.0.0.1:11434',
    model: process.env.AI_MODEL || 'qwen3.5:4b',
    userLimit: 10, // normal üye: 10 dakikada en fazla 10 mesaj (yetkililer sınırsız)
  },

  owner: { id: '711654142636195850', name: 'BEKO' },

  brand: {
    name: 'Karia',
    color: 0x3fe0c5, // logodaki turkuaz
  },

  minecraft: {
    // Boş bırakılırsa MC özellikleri (/ip durumu, oyuncu sayısı) kapalı kalır.
    host: '', // örn: 'play.karia.net'
    port: 25565,
    displayIp: '', // oyunculara gösterilecek IP (boşsa host kullanılır)
    version: '', // örn: '1.21.x'
  },

  // Boş olanlar /linkler ve bağlantılar panelinde gösterilmez.
  links: {
    website: 'https://karia.live',
    discord: 'https://discord.gg/karia',
    instagram: 'https://www.instagram.com/karia.live/',
    tiktok: 'https://www.tiktok.com/@karia.live',
    youtube: 'https://www.youtube.com/@karialivemedya',
    x: '',
    github: '',
  },

  // Destek talebi kategorileri (en fazla 25)
  ticketCategories: [
    { value: 'minecraft', label: 'Minecraft Sorunu', emoji: '⛏️', icon: 'kazma', description: 'Oyun içi sorunlar, bağlantı, eşya kaybı' },
    { value: 'hata', label: 'Hata Bildirimi', emoji: '🐛', icon: 'kod', description: 'Bot, website veya sunucuda bulduğun hatalar' },
    { value: 'sikayet', label: 'Şikayet', emoji: '⚠️', icon: 'unlem', description: 'Bir oyuncu ya da üye hakkında şikayet' },
    { value: 'sponsor', label: 'Sponsorluk / İş Birliği', emoji: '🤝', icon: 'roket', description: 'Sponsorluk ve iş birliği teklifleri' },
    { value: 'diger', label: 'Diğer', emoji: '❓', icon: 'soru', description: 'Diğer konular' },
  ],
};
