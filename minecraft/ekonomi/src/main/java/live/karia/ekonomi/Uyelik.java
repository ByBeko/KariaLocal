package live.karia.ekonomi;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import net.milkbowl.vault.permission.Permission;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;

/**
 * Üyelik kademeleri (VIP < VIP+ < KVIP < Prime). Kaynak Discord'daki süreli roldür:
 * bot /mc/player ile en yüksek kademeyi bildirir, burada LuckPerms grubu (Vault üzerinden) ona eşitlenir.
 * /uyelikal kademeyi coin ile 30 günlüğüne alır (/mc/tier).
 */
final class Uyelik {
    record Bilgi(String kademe, Long bitis) {}

    private final KariaEkonomi k;
    private final Map<UUID, Bilgi> son = new ConcurrentHashMap<>();

    Uyelik(KariaEkonomi k) {
        this.k = k;
    }

    private boolean aktif() {
        return k.getConfig().getBoolean("uyelik.aktif", true);
    }

    List<String> kademeler() {
        return k.getConfig().getStringList("uyelik.gruplar");
    }

    String ad(String kademe) {
        return k.getConfig().getString("uyelik.adlar." + kademe, kademe);
    }

    long fiyat(String kademe) {
        return k.getConfig().getLong("uyelik.fiyatlar." + kademe, 0);
    }

    private Permission izinler() {
        RegisteredServiceProvider<Permission> r = Bukkit.getServicesManager().getRegistration(Permission.class);
        return r == null ? null : r.getProvider();
    }

    /** Ana iş parçacığından. kademe null: üyeliği yok ya da hesabı bağlı değil. */
    void esitle(UUID uuid, String kademe, Long bitis) {
        if (!aktif()) return;
        Player p = Bukkit.getPlayer(uuid);
        Permission perms = izinler();
        if (p == null || perms == null) return;
        if (kademe != null && !kademeler().contains(kademe)) kademe = null;
        Bilgi onceki = son.put(uuid, new Bilgi(kademe, bitis));
        boolean degisti = false;
        for (String g : kademeler()) {
            boolean olmali = g.equals(kademe);
            boolean var = perms.playerInGroup((String) null, p, g);
            if (olmali && !var) degisti |= perms.playerAddGroup((String) null, p, g);
            else if (!olmali && var) degisti |= perms.playerRemoveGroup((String) null, p, g);
        }
        if (!degisti) return;
        if (kademe != null) {
            k.msg(p, "&fÜyeliğin aktif: &#FFD43B&l" + ad(kademe) + " &8(/uyelik)");
            p.sendTitle(KariaEkonomi.color("&#FFD43B&l" + ad(kademe).toUpperCase(Locale.ROOT)), KariaEkonomi.color("&7Üyeliğin aktif, iyi oyunlar!"), 5, 50, 15);
            p.playSound(p.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.7f, 1.2f);
        } else if (onceki != null && onceki.kademe() != null) {
            k.msg(p, "&7" + ad(onceki.kademe()) + " üyeliğinin süresi doldu. Yenilemek için &f/magaza&7.");
        }
    }

    void cikis(UUID uuid) {
        son.remove(uuid);
    }

    void durum(Player p) {
        Bilgi b = son.get(p.getUniqueId());
        if (!k.isLinked(p.getUniqueId())) {
            k.msg(p, "&7Üyelik için önce hesabını bağla: &f/bagla");
            return;
        }
        if (b == null || b.kademe() == null) {
            k.msg(p, "&7Üyeliğin yok. Kademeler: &f" + String.join("&7, &f", kademeler().stream().map(this::ad).toList()) + " &8(/magaza)");
            return;
        }
        String bitis = "süresiz";
        if (b.bitis() != null) {
            long kalan = Math.max(0, b.bitis() - System.currentTimeMillis()) / 60_000;
            bitis = (kalan / 1440) + " gün " + (kalan % 1440 / 60) + " saat kaldı";
        }
        k.msg(p, "&fÜyeliğin: &#FFD43B&l" + ad(b.kademe()) + " &8(" + bitis + ")");
    }

    /** /uyelikal <kademe> */
    void satinAl(Player p, String kademe, BotApi api) {
        kademe = kademe.toLowerCase(Locale.ROOT);
        if (!kademeler().contains(kademe)) {
            k.msg(p, "&cGeçersiz kademe. &7Kademeler: &f" + String.join(", ", kademeler()));
            return;
        }
        UUID uuid = p.getUniqueId();
        if (!api.configured() || !k.isLinked(uuid)) {
            k.msg(p, "&cÜyelik almak için hesabını Discord'a bağlamalısın: &f/bagla");
            return;
        }
        long fiyat = fiyat(kademe);
        if (fiyat > 0 && k.balanceOf(Ledger.key(uuid)) < fiyat) {
            k.msg(p, "&cYeterli coinin yok. &7Gereken: &f" + fiyat + " coin");
            p.playSound(p.getLocation(), Sound.ENTITY_VILLAGER_NO, 0.8f, 1f);
            return;
        }
        final String secilen = kademe;
        final String tx = "ke-uye-" + UUID.randomUUID();
        k.msg(p, "&7" + ad(secilen) + " alınıyor...");
        Bukkit.getScheduler().runTaskAsynchronously(k, () -> {
            BotApi.Result r = api.tier(uuid, secilen, tx);
            if (r.status() == 0 || r.status() >= 500) r = api.tier(uuid, secilen, tx); // aynı işlem no: iki kez ücret alınmaz
            final BotApi.Result son = r;
            Bukkit.getScheduler().runTask(k, () -> {
                if (son.ok()) {
                    Long bal = son.num("balance");
                    if (bal != null && !k.ledger().hasPending(uuid) && k.ledger().linked.containsKey(uuid)) k.ledger().linked.put(uuid, bal);
                    k.refresh(uuid, false);
                    k.msg(p, "&a" + ad(secilen) + " üyeliğini 30 günlüğüne aldın!");
                    Bukkit.broadcastMessage(KariaEkonomi.color(k.getConfig().getString("mesaj-oneki", "") + "&f" + p.getName() + " &7artık &#FFD43B&l" + ad(secilen) + "&7! Tebrikler."));
                } else {
                    String err = son.str("error");
                    k.msg(p, "&c" + (err != null ? err : "Şu an alınamıyor, biraz sonra tekrar dene."));
                    p.playSound(p.getLocation(), Sound.ENTITY_VILLAGER_NO, 0.8f, 1f);
                }
            });
        });
    }

    List<String> tamamla(String bas) {
        List<String> out = new ArrayList<>();
        for (String g : kademeler()) if (g.startsWith(bas.toLowerCase(Locale.ROOT))) out.add(g);
        return out;
    }

}
