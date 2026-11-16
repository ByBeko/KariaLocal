package live.karia.ekonomi;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

/**
 * Oyundan Discord'a: /destek (talep kanalı açar ya da açık talebe yazar), /oneri (öneri kanalı), /rapor (yetkili rapor kanalı).
 * Yetkililerin talep kanalına yazdığı yanıtlar düzenli aralıkla çekilip oyuncuya oyunda gösterilir.
 */
final class Destek implements CommandExecutor, TabCompleter {
    private static final Pattern AD = Pattern.compile("\\.?[A-Za-z0-9_]{1,16}");
    private static final Pattern YANIT = Pattern.compile(
            "\\{\"uuid\":\"([0-9a-f-]{36})\",\"author\":\"((?:[^\"\\\\]|\\\\.)*)\",\"text\":\"((?:[^\"\\\\]|\\\\.)*)\",\"at\":\\d+\\}");

    private final KariaEkonomi k;
    private final BotApi api;

    Destek(KariaEkonomi k, BotApi api) {
        this.k = k;
        this.api = api;
        long sn = Math.max(10, k.getConfig().getLong("destek.yanit-yoklama-saniye", 15));
        Bukkit.getScheduler().runTaskTimer(k, this::yokla, 200L, sn * 20L);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if (!(sender instanceof Player p)) {
            sender.sendMessage("Bu komut oyun içinde kullanılır.");
            return true;
        }
        if (!api.configured()) {
            k.msg(p, "&cDiscord bağlantısı şu an kapalı. &7Yetkililere sohbetten yaz.");
            return true;
        }
        Location l = p.getLocation();
        String dunya = l.getWorld() == null ? "" : l.getWorld().getName();
        int x = l.getBlockX(), y = l.getBlockY(), z = l.getBlockZ();
        UUID id = p.getUniqueId();
        String ad = p.getName();
        switch (cmd.getName()) {
            case "destek" -> {
                String metin = String.join(" ", args).trim();
                if (metin.length() < 3) {
                    k.msg(p, "&7Kullanım: &f/destek <mesaj> &8- &7yetkililere yazar, cevap burada görünür.");
                    return true;
                }
                gonder(p, () -> api.ticket(id, ad, metin, dunya, x, y, z), r -> {
                    Long no = r.num("number");
                    if (r.bool("created")) {
                        k.msg(p, "&aDestek talebin açıldı" + (no != null ? " &8(#" + no + ")" : "") + "&a. &7Yetkililer cevap verince burada göreceksin.");
                        k.msg(p, "&7Eklemek istediğin bir şey olursa yine &f/destek <mesaj> &7yaz.");
                    } else {
                        k.msg(p, "&aMesajın destek talebine eklendi" + (no != null ? " &8(#" + no + ")" : "") + "&a.");
                    }
                });
            }
            case "oneri" -> {
                String metin = String.join(" ", args).trim();
                if (metin.length() < 10) {
                    k.msg(p, "&7Kullanım: &f/oneri <önerin> &8(en az 10 karakter)");
                    return true;
                }
                gonder(p, () -> api.suggestion(id, ad, metin),
                        r -> k.msg(p, "&aÖnerin Discord'daki öneri kanalına gönderildi, oylamaya açıldı. Teşekkürler!"));
            }
            case "rapor" -> {
                if (args.length < 2) {
                    k.msg(p, "&7Kullanım: &f/rapor <oyuncu> <sebep> &8- &7yetkililere gizlice bildirir.");
                    return true;
                }
                String hedef = args[0];
                if (!AD.matcher(hedef).matches()) {
                    k.msg(p, "&cGeçersiz oyuncu adı.");
                    return true;
                }
                if (hedef.equalsIgnoreCase(ad)) {
                    k.msg(p, "&cKendini raporlayamazsın.");
                    return true;
                }
                String sebep = String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length)).trim();
                if (sebep.length() < 5) {
                    k.msg(p, "&cSebebi biraz daha açık yaz &7(en az 5 karakter).");
                    return true;
                }
                gonder(p, () -> api.report(id, ad, hedef, sebep, dunya, x, y, z),
                        r -> k.msg(p, "&aRaporun yetkililere iletildi. &7Teşekkürler, kimseye senin bildirdiğin söylenmez."));
            }
            default -> { }
        }
        return true;
    }

    /** İsteği arka planda gönderir, sonucu ana iş parçacığında oyuncuya yazar. */
    private void gonder(Player p, Supplier<BotApi.Result> istek, Consumer<BotApi.Result> basari) {
        UUID id = p.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(k, () -> {
            BotApi.Result r = istek.get();
            Bukkit.getScheduler().runTask(k, () -> {
                Player o = Bukkit.getPlayer(id);
                if (o == null) return;
                if (r.ok()) {
                    basari.accept(r);
                    o.playSound(o.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.6f, 1.2f);
                } else if (r.status() == 429) {
                    Long sn = r.num("wait");
                    k.msg(o, "&7Biraz bekle" + (sn != null ? ": &f" + sn + " sn" : "") + " &7sonra tekrar dene.");
                } else if (r.status() == 400 && r.str("error") != null) {
                    k.msg(o, "&c" + r.str("error"));
                } else {
                    k.msg(o, "&cDiscord'a şu an ulaşılamıyor, birazdan tekrar dene.");
                }
            });
        });
    }

    /** Çevrimiçi oyuncuların bekleyen destek yanıtlarını çeker ve gösterir. */
    private void yokla() {
        if (!api.configured()) return;
        List<UUID> ids = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) ids.add(p.getUniqueId());
        if (ids.isEmpty()) return;
        Bukkit.getScheduler().runTaskAsynchronously(k, () -> {
            BotApi.Result r = api.ticketReplies(ids);
            if (!r.ok()) return;
            List<String[]> gelen = new ArrayList<>();
            Matcher m = YANIT.matcher(r.body());
            while (m.find()) gelen.add(new String[]{m.group(1), coz(m.group(2)), coz(m.group(3))});
            if (gelen.isEmpty()) return;
            Bukkit.getScheduler().runTask(k, () -> {
                java.util.Set<UUID> bildirilen = new java.util.HashSet<>();
                for (String[] g : gelen) {
                    Player p = Bukkit.getPlayer(UUID.fromString(g[0]));
                    if (p == null) continue;
                    // Yetkili metni renk koduna çevrilmez
                    p.sendMessage(KariaEkonomi.color("&8[&bDestek&8] &f") + g[1].replace("§", "")
                            + KariaEkonomi.color("&7: &f") + g[2].replace("§", ""));
                    if (bildirilen.add(p.getUniqueId())) {
                        p.playSound(p.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.8f, 1.6f);
                        Bukkit.getScheduler().runTaskLater(k, () -> {
                            if (p.isOnline()) p.sendMessage(KariaEkonomi.color("&8» &7Cevap yazmak için: &f/destek <mesaj>"));
                        }, 2L);
                    }
                }
            });
        });
    }

    /** JSON metin kaçışlarını çözer. */
    private static String coz(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) {
                sb.append(c);
                continue;
            }
            char n = s.charAt(++i);
            switch (n) {
                case 'n' -> sb.append(' ');
                case 't' -> sb.append(' ');
                case 'r' -> { }
                case 'u' -> {
                    if (i + 4 < s.length()) {
                        sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
                        i += 4;
                    }
                }
                default -> sb.append(n);
            }
        }
        return sb.toString();
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command cmd, String alias, String[] args) {
        List<String> l = new ArrayList<>();
        if (cmd.getName().equals("rapor") && args.length == 1) {
            for (Player o : Bukkit.getOnlinePlayers()) {
                if (!o.equals(sender) && o.getName().toLowerCase().startsWith(args[0].toLowerCase())) l.add(o.getName());
            }
        }
        return l;
    }
}
