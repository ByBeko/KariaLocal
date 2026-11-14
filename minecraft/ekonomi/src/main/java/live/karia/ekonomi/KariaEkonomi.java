package live.karia.ekonomi;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.milkbowl.vault.economy.Economy;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Sound;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;

public final class KariaEkonomi extends JavaPlugin implements Listener {
    private final Ledger ledger = new Ledger();
    private final AtomicBoolean working = new AtomicBoolean(false);
    private BotApi api;
    private File dataFile;
    private volatile long backoffUntil = 0;
    private volatile boolean dirty = false;
    private volatile String lastApiError = null;

    Ledger ledger() { return ledger; }

    @Override
    public void onEnable() {
        saveDefaultConfig();
        api = new BotApi(getConfig().getString("api.url", ""), getConfig().getString("api.secret", ""), getConfig().getInt("api.timeout-seconds", 5));
        if (!api.configured()) getLogger().warning("api.secret boş: Discord cüzdanı devre dışı, herkes yerel cüzdan kullanır.");
        dataFile = new File(getDataFolder(), "veri.yml");
        ledger.load(dataFile);

        getServer().getServicesManager().register(Economy.class, new KariaEconomy(this), this, ServicePriority.Highest);
        getServer().getPluginManager().registerEvents(this, this);

        // Kuyruk: her saniye bota iletmeyi dene
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::drainQueue, 40L, 20L);
        // Bağlı oyuncuların bakiyesini yenile
        long every = Math.max(15, getConfig().getLong("yenileme-saniye", 60)) * 20L;
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            for (Player p : Bukkit.getOnlinePlayers()) refresh(p.getUniqueId(), false);
        }, every, every);
        // Kayıt
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, () -> { if (dirty) save(); }, 600L, 600L);
        for (Player p : Bukkit.getOnlinePlayers()) onJoin(p);
        getLogger().info("KariaEkonomi hazır (Vault). Bekleyen işlem: " + ledger.queue.size());
    }

    @Override
    public void onDisable() {
        save();
    }

    private void save() {
        try {
            dirty = false;
            ledger.save(dataFile);
        } catch (Exception e) {
            dirty = true;
            getLogger().warning("veri.yml kaydedilemedi: " + e.getMessage());
        }
    }

    // ── bakiye ──

    private static UUID uuidOf(String key) {
        if (!key.startsWith("u:")) return null;
        try { return UUID.fromString(key.substring(2)); } catch (IllegalArgumentException e) { return null; }
    }

    boolean isLinked(UUID uuid) { return uuid != null && ledger.linked.containsKey(uuid); }

    long balanceOf(String key) {
        UUID uuid = uuidOf(key);
        long local = ledger.localOf(key);
        return isLinked(uuid) ? ledger.linked.get(uuid) + local : local;
    }

    /** Ana iş parçacığından çağrılır. Bağlı oyuncuda önbellek hemen değişir, işlem bota sıraya girer. */
    void change(String key, long delta, String reason) {
        UUID uuid = uuidOf(key);
        if (isLinked(uuid) && api.configured()) {
            ledger.linked.merge(uuid, delta, Long::sum);
            ledger.queue.add(new Ledger.Op("ke-" + UUID.randomUUID(), uuid, delta, reason));
        } else {
            ledger.addLocal(key, delta);
        }
        dirty = true;
    }

    // ── bot ile eşitleme ──

    private void drainQueue() {
        if (!api.configured() || System.currentTimeMillis() < backoffUntil || !working.compareAndSet(false, true)) return;
        try {
            Ledger.Op op;
            while ((op = ledger.queue.peekFirst()) != null) {
                BotApi.Result r = api.balance(op.uuid(), op.amount(), op.txId(), op.reason());
                final Ledger.Op done = op;
                if (r.ok()) {
                    ledger.queue.pollFirst();
                    Long bal = r.num("balance");
                    Bukkit.getScheduler().runTask(this, () -> {
                        if (bal != null && !ledger.hasPending(done.uuid()) && ledger.linked.containsKey(done.uuid())) ledger.linked.put(done.uuid(), bal);
                    });
                    dirty = true;
                    lastApiError = null;
                } else if (r.rejected()) {
                    // Bot reddetti (yetersiz bakiye, hesap bağlı değil...). Oyun içinde işlem çoktan yapıldı:
                    // tutar yerel deftere geçer (harcamada borç, kazançta yerel para olur), görünen bakiye değişmez.
                    ledger.queue.pollFirst();
                    String err = r.str("error");
                    getLogger().warning("Bot işlemi reddetti (" + done.uuid() + ", " + done.amount() + "): " + err);
                    Bukkit.getScheduler().runTask(this, () -> {
                        boolean unlinked = err != null && err.toLowerCase(Locale.ROOT).contains("bağlı değil");
                        if (ledger.linked.containsKey(done.uuid())) ledger.linked.merge(done.uuid(), -done.amount(), Long::sum);
                        ledger.addLocal(Ledger.key(done.uuid()), done.amount());
                        if (unlinked && !ledger.hasPending(done.uuid())) {
                            ledger.linked.remove(done.uuid());
                        }
                        dirty = true;
                    });
                } else {
                    lastApiError = "HTTP " + r.status();
                    backoffUntil = System.currentTimeMillis() + 15_000;
                    break;
                }
            }
        } finally {
            working.set(false);
        }
    }

    /** Bot bakiyesini çeker. merge: yerel bakiyeyi (varsa) bot cüzdanına aktar. */
    void refresh(UUID uuid, boolean merge) {
        if (!api.configured()) return;
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            BotApi.Result r = api.player(uuid);
            if (!r.ok()) { lastApiError = "HTTP " + r.status(); return; }
            boolean linked = r.bool("linked");
            Long bal = r.num("balance");
            Bukkit.getScheduler().runTask(this, () -> {
                if (linked && bal != null) {
                    if (!ledger.hasPending(uuid)) ledger.linked.put(uuid, bal);
                    String key = Ledger.key(uuid);
                    long local = ledger.localOf(key);
                    if (merge && local != 0) {
                        ledger.local.remove(key);
                        change(key, local, local > 0 ? "Yerel bakiye aktarımı" : "Yerel borç");
                        Player p = Bukkit.getPlayer(uuid);
                        if (p != null && local > 0) msg(p, "&a" + local + " " + currency(local) + " yerel bakiyen Discord cüzdanına aktarıldı.");
                    }
                } else if (!linked && ledger.linked.containsKey(uuid) && !ledger.hasPending(uuid)) {
                    ledger.linked.remove(uuid);
                }
                dirty = true;
            });
        });
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) { onJoin(e.getPlayer()); }

    private void onJoin(Player p) {
        UUID uuid = p.getUniqueId();
        boolean first = !ledger.names.containsValue(uuid) && !ledger.linked.containsKey(uuid) && !ledger.local.containsKey(Ledger.key(uuid));
        ledger.names.put(p.getName().toLowerCase(Locale.ROOT), uuid);
        long start = getConfig().getLong("baslangic-parasi", 0);
        if (first && start > 0) ledger.addLocal(Ledger.key(uuid), start);
        dirty = true;
        refresh(uuid, true);
    }

    // ── komutlar ──

    private static final Pattern HEX = Pattern.compile("&#([0-9a-fA-F]{6})");

    static String color(String s) {
        Matcher m = HEX.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            StringBuilder x = new StringBuilder("§x");
            for (char c : m.group(1).toCharArray()) x.append('§').append(c);
            m.appendReplacement(sb, Matcher.quoteReplacement(x.toString()));
        }
        m.appendTail(sb);
        return ChatColor.translateAlternateColorCodes('&', sb.toString());
    }

    void msg(CommandSender s, String text) { s.sendMessage(color(getConfig().getString("mesaj-oneki", "") + text)); }

    String currency(long a) { return a == 1 ? getConfig().getString("para-birimi.tekil", "coin") : getConfig().getString("para-birimi.cogul", "coin"); }

    private UUID resolve(String name) {
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) return online.getUniqueId();
        return ledger.names.get(name.toLowerCase(Locale.ROOT));
    }

    private static Long parseAmount(String s) {
        try { long v = Long.parseLong(s); return v > 0 ? v : null; } catch (NumberFormatException e) { return null; }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        switch (cmd.getName().toLowerCase(Locale.ROOT)) {
            case "bagla" -> {
                if (!(sender instanceof Player p)) { msg(sender, "&cBu komut oyunda kullanılır."); return true; }
                if (!api.configured()) { msg(p, "&cDiscord cüzdanı şu an kapalı."); return true; }
                msg(p, "&7Kod alınıyor...");
                UUID uuid = p.getUniqueId();
                String name = p.getName();
                Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                    BotApi.Result r = api.linkCode(uuid, name);
                    Bukkit.getScheduler().runTask(this, () -> {
                        if (!r.ok()) { msg(p, "&cKod alınamadı: " + (r.str("error") != null ? r.str("error") : "bota ulaşılamıyor")); return; }
                        if (r.bool("linked")) { msg(p, "&aHesabın zaten Discord cüzdanına bağlı."); refresh(uuid, true); return; }
                        String site = getConfig().getString("bagla-adresi", "karia.live/minecraft");
                        msg(p, "&fBağlama kodun: &#FFD43B&l" + r.str("code"));
                        msg(p, "&7Kodu &#5BE0F0" + site + " &7sayfasında Discord ile giriş yapıp gir. &8(10 dk geçerli)");
                        p.playSound(p.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.7f, 1.4f);
                    });
                });
                return true;
            }
            case "bakiye" -> {
                UUID target;
                String shown;
                if (args.length >= 1 && sender.hasPermission("karia.ekonomi.bakiye.diger")) {
                    target = resolve(args[0]);
                    shown = args[0];
                    if (target == null) { msg(sender, "&cOyuncu bulunamadı."); return true; }
                } else if (sender instanceof Player p) {
                    target = p.getUniqueId();
                    shown = null;
                } else { msg(sender, "&cKullanım: /bakiye <oyuncu>"); return true; }
                long bal = balanceOf(Ledger.key(target));
                String where = isLinked(target) ? "&8(Discord cüzdanı)" : "&8(yerel cüzdan, &7/bagla &8ile Discord'a bağla)";
                msg(sender, (shown != null ? "&f" + shown + " bakiyesi: " : "&fBakiyen: ") + "&#FFD43B&l" + bal + " " + currency(bal) + " " + where);
                return true;
            }
            case "ode" -> {
                if (!(sender instanceof Player p)) { msg(sender, "&cBu komut oyunda kullanılır."); return true; }
                if (args.length < 2) { msg(p, "&cKullanım: /ode <oyuncu> <miktar>"); return true; }
                UUID to = resolve(args[0]);
                Long a = parseAmount(args[1]);
                if (to == null) { msg(p, "&cOyuncu bulunamadı."); return true; }
                if (a == null) { msg(p, "&cGeçersiz miktar."); return true; }
                if (to.equals(p.getUniqueId())) { msg(p, "&cKendine para gönderemezsin."); return true; }
                String fromKey = Ledger.key(p.getUniqueId());
                if (balanceOf(fromKey) < a) { msg(p, "&cYetersiz bakiye."); return true; }
                change(fromKey, -a, "Oyuncuya ödeme: " + args[0]);
                change(Ledger.key(to), a, "Oyuncudan ödeme: " + p.getName());
                msg(p, "&a" + args[0] + " oyuncusuna " + a + " " + currency(a) + " gönderdin.");
                p.playSound(p.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.7f, 1.2f);
                Player tp = Bukkit.getPlayer(to);
                if (tp != null) msg(tp, "&a" + p.getName() + " sana " + a + " " + currency(a) + " gönderdi.");
                return true;
            }
            case "ekonomi" -> {
                if (args.length >= 1 && args[0].equalsIgnoreCase("durum")) {
                    msg(sender, "&fBot bağlantısı: " + (!api.configured() ? "&ckapalı (api.secret boş)" : lastApiError == null ? "&atamam" : "&chata (" + lastApiError + ")"));
                    msg(sender, "&fBekleyen işlem: &e" + ledger.queue.size() + " &8| &fBağlı oyuncu: &e" + ledger.linked.size());
                    return true;
                }
                if (args.length < 3 || !(args[0].equalsIgnoreCase("ver") || args[0].equalsIgnoreCase("al"))) {
                    msg(sender, "&cKullanım: /ekonomi <ver|al> <oyuncu> <miktar> | /ekonomi durum");
                    return true;
                }
                UUID to = resolve(args[1]);
                Long a = parseAmount(args[2]);
                if (to == null) { msg(sender, "&cOyuncu bulunamadı (sunucuya en az bir kez girmiş olmalı)."); return true; }
                if (a == null) { msg(sender, "&cGeçersiz miktar."); return true; }
                long delta = args[0].equalsIgnoreCase("ver") ? a : -a;
                change(Ledger.key(to), delta, "Yönetici: " + sender.getName());
                msg(sender, "&a" + args[1] + " bakiyesi " + (delta > 0 ? "+" : "") + delta + ". Yeni bakiye: " + balanceOf(Ledger.key(to)));
                return true;
            }
            default -> { return false; }
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command cmd, String alias, String[] args) {
        String c = cmd.getName().toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();
        if (c.equals("ekonomi") && args.length == 1) { for (String s : new String[]{"ver", "al", "durum"}) if (s.startsWith(args[0].toLowerCase(Locale.ROOT))) out.add(s); return out; }
        int nameArg = c.equals("ekonomi") ? 2 : 1;
        if ((c.equals("ode") || c.equals("bakiye") || c.equals("ekonomi")) && args.length == nameArg) {
            for (Player p : Bukkit.getOnlinePlayers()) if (p.getName().toLowerCase(Locale.ROOT).startsWith(args[nameArg - 1].toLowerCase(Locale.ROOT))) out.add(p.getName());
        }
        return out;
    }
}
