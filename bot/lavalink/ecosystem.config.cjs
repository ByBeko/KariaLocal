// Lavalink'i pm2 ile başlatır. Bu klasörde: pm2 start ecosystem.config.cjs && pm2 save
// Şifre ve port bot/.env dosyasından okunur (botla aynı değerler); bu dosyada sır yok.
const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env yoksa makinenin ortam değişkenleri kullanılır
}
if (!process.env.LAVALINK_PASSWORD) throw new Error('bot/.env içinde LAVALINK_PASSWORD yok.');

module.exports = {
  apps: [
    {
      name: 'Lavalink',
      cwd: __dirname,
      script: 'java',
      interpreter: 'none',
      // 1 GB RAM'li makinede 512 MB yeter; makine büyükse artırılabilir
      args: ['-Xmx512m', '-jar', 'Lavalink.jar'],
      env: {
        LAVALINK_PASSWORD: process.env.LAVALINK_PASSWORD,
        LAVALINK_PORT: process.env.LAVALINK_PORT || '2333',
        LAVALINK_YT_REFRESH_TOKEN: process.env.LAVALINK_YT_REFRESH_TOKEN || '',
      },
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
    },
  ],
};
