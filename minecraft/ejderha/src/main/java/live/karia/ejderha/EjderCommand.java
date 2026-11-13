package live.karia.ejderha;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Supplier;

/** /ejder — oyuncu ve yönetici komutları. */
public final class EjderCommand implements TabExecutor {
    private final KariaEjderha plugin;

    EjderCommand(KariaEjderha plugin) { this.plugin = plugin; }

    private static void msg(CommandSender s, String text, NamedTextColor c) { s.sendMessage(Component.text(text, c)); }

    @Override
    public boolean onCommand(CommandSender s, Command cmd, String label, String[] a) {
        String sub = a.length == 0 ? "liste" : a[0].toLowerCase(Locale.ROOT);
        boolean admin = s.hasPermission("karia.ejder.admin");
        switch (sub) {
            case "liste" -> { if (s instanceof Player p) list(p); else help(s, admin); }
            case "cagir" -> { if (s instanceof Player p) call(p, a.length > 1 ? join(a, 1) : null); }
            case "gonder" -> { if (s instanceof Player p) send(p); }
            case "bilgi" -> { if (s instanceof Player p) info(p); }
            case "turler" -> species(s);
            case "ada" -> { if (s instanceof Player p) island(p); }
            case "demir" -> {
                if (!(s instanceof Player p)) break;
                Ship sh = plugin.ships().nearest(p, 24);
                if (sh == null) { msg(p, "Yakında gemi yok.", NamedTextColor.GRAY); break; }
                if (!sh.owner.equals(p.getUniqueId()) && !admin) { msg(p, "Bu gemi senin değil.", NamedTextColor.RED); break; }
                plugin.ships().anchor(sh, p, false);
            }
            case "yardim" -> help(s, admin);
            case "ver" -> { if (admin) give(s, a); else noPerm(s); }
            case "dogur" -> { if (admin) spawn(s, a); else noPerm(s); }
            case "temizle" -> { if (admin) clear(s); else noPerm(s); }
            case "gemikur" -> { // yönetici/konsol testi: /ejder gemikur <x> <y> <z> [dünya]
                if (!admin || a.length < 4) { noPerm(s); break; }
                org.bukkit.World w = a.length > 4 ? Bukkit.getWorld(a[4]) : (s instanceof Player p ? p.getWorld() : Bukkit.getWorlds().get(0));
                if (w == null) break;
                plugin.ships().assemble(null, w.getBlockAt(parseInt(a[1], 0), parseInt(a[2], 0), parseInt(a[3], 0)));
            }
            case "gemidemir" -> {
                if (!admin) { noPerm(s); break; }
                int n = 0;
                for (Ship sh : new ArrayList<>(plugin.ships().all())) if (plugin.ships().anchor(sh, null, false)) n++;
                msg(s, n + " gemiye demir atıldı (" + plugin.ships().count() + " kaldı).", NamedTextColor.GREEN);
            }
            case "gemidurum" -> {
                if (!admin) { noPerm(s); break; }
                for (Ship sh : plugin.ships().all())
                    msg(s, String.format("gemi %s %s %.2f %.2f %.2f yaw=%.1f blok=%d ucar=%s", sh.id.toString().substring(0, 8), sh.world.getName(), sh.x, sh.y, sh.z, sh.yaw, sh.parts.size(), sh.canFly), NamedTextColor.GRAY);
            }
            case "yenile" -> {
                if (!admin) { noPerm(s); break; }
                plugin.reloadAll();
                msg(s, "KariaEjderha yenilendi: " + Species.all().size() + " tür.", NamedTextColor.GREEN);
            }
            default -> help(s, admin);
        }
        return true;
    }

    private void island(Player p) {
        String wn = plugin.getConfig().getString("dunya.ad", "Ejder_Adasi");
        org.bukkit.World w = Bukkit.getWorld(wn);
        if (w == null) { msg(p, "Ejder Adası henüz açılmadı.", NamedTextColor.RED); return; }
        if (p.getWorld() == w) { msg(p, "Zaten Ejder Adası'ndasın.", NamedTextColor.GRAY); return; }
        p.teleportAsync(w.getSpawnLocation().add(0.5, 0, 0.5)).thenAccept(ok -> {
            if (ok) p.showTitle(net.kyori.adventure.title.Title.title(Component.text("Ejder Adası", NamedTextColor.GOLD),
                    Component.text("Ejderhalar, Viking kampları, gemiler", NamedTextColor.GRAY)));
        });
    }

    private void noPerm(CommandSender s) { msg(s, "Bu komut için yetkin yok.", NamedTextColor.RED); }

    private void help(CommandSender s, boolean admin) {
        msg(s, "— Karia Ejderhaları —", NamedTextColor.GOLD);
        msg(s, "/ejder liste · ejderhaların", NamedTextColor.GRAY);
        msg(s, "/ejder cagir [ad] · ejderhanı yanına çağır (ahırdan da)", NamedTextColor.GRAY);
        msg(s, "/ejder gonder · baktığın ejderhanı ahıra gönder", NamedTextColor.GRAY);
        msg(s, "/ejder bilgi · baktığın ejderha hakkında bilgi", NamedTextColor.GRAY);
        msg(s, "/ejder turler · tüm türler ve yaşadıkları yerler", NamedTextColor.GRAY);
        msg(s, "/ejder ada · Ejder Adası'na git", NamedTextColor.GRAY);
        msg(s, "/ejder demir · yakındaki gemine demir at", NamedTextColor.GRAY);
        if (admin) msg(s, "Yönetici: ver <tür|eşya> [oyuncu] [adet] · dogur <tür> [yavru|genc|yetiskin] [evcil] · temizle · yenile", NamedTextColor.DARK_GRAY);
    }

    private void list(Player p) {
        var list = plugin.dragons().owned(p.getUniqueId());
        if (list.isEmpty()) { msg(p, "Henüz ejderhan yok. Vahşi bir ejderhayı en sevdiği yemle evcilleştir ya da yumurta çatlat.", NamedTextColor.GRAY); return; }
        msg(p, "— Ejderhaların (" + list.size() + "/" + plugin.getConfig().getInt("oyuncu-basina-en-cok", 4) + ") —", NamedTextColor.GOLD);
        for (var e : list) {
            Species sp = Species.get(e.species());
            if (sp == null) continue;
            String where = e.stabled() ? "ahırda" : e.world() + " " + (int) e.x() + ", " + (int) e.y() + ", " + (int) e.z();
            Component line = Component.text("• " + e.name(), sp.color)
                    .append(Component.text(" (" + sp.name + ") ", NamedTextColor.GRAY))
                    .append(Component.text(where, NamedTextColor.DARK_GRAY))
                    .append(Component.text("  [çağır]", NamedTextColor.GREEN).clickEvent(ClickEvent.runCommand("/ejder cagir " + e.name())));
            p.sendMessage(line);
        }
    }

    private void call(Player p, String name) {
        var list = plugin.dragons().owned(p.getUniqueId());
        if (list.isEmpty()) { msg(p, "Çağıracak ejderhan yok.", NamedTextColor.GRAY); return; }
        DragonManager.Entry pick = null;
        if (name != null) for (var e : list) if (e.name() != null && e.name().equalsIgnoreCase(name)) { pick = e; break; }
        if (pick == null && name != null) { msg(p, "Bu adda bir ejderhan yok.", NamedTextColor.RED); return; }
        if (pick == null) pick = list.get(0);
        if (pick.stabled()) {
            Dragon d = plugin.dragons().unstable(p, pick);
            if (d != null) msg(p, d.displayName() + " ahırdan çıktı!", NamedTextColor.GREEN);
            return;
        }
        final DragonManager.Entry fp = pick;
        plugin.dragons().summon(p, pick, d -> {
            if (d == null) msg(p, fp.name() + " bulunamadı (ölmüş ya da dünyası yok). Kayıt temizlendi.", NamedTextColor.RED);
            else msg(p, d.displayName() + " geldi!", NamedTextColor.GREEN);
        });
    }

    private Dragon looked(Player p) {
        Entity t = p.getTargetEntity(12);
        Dragon d = plugin.dragons().byEntity(t);
        if (d == null && p.getVehicle() != null) d = plugin.dragons().byEntity(p.getVehicle());
        return d;
    }

    private void send(Player p) {
        Dragon d = looked(p);
        if (d == null) { msg(p, "Bir ejderhaya bakarak kullan.", NamedTextColor.GRAY); return; }
        if (!p.getUniqueId().equals(d.owner())) { msg(p, "Bu ejderha senin değil.", NamedTextColor.RED); return; }
        String n = d.displayName();
        plugin.dragons().stable(d);
        msg(p, n + " ahıra gönderildi. /ejder cagir " + n + " ile geri çağırabilirsin.", NamedTextColor.GREEN);
    }

    private void info(Player p) {
        Dragon d = looked(p);
        if (d == null) { msg(p, "Bir ejderhaya bakarak kullan.", NamedTextColor.GRAY); return; }
        String owner = d.isTamed() ? Bukkit.getOfflinePlayer(d.owner()).getName() : "vahşi";
        p.sendMessage(Component.text(d.displayName(), d.species.color).append(Component.text(" — " + d.species.name, NamedTextColor.GRAY)));
        msg(p, "Sahip: " + owner + " · Evre: " + d.stageName() + " (%" + (int) (d.growth() * 100) + ")", NamedTextColor.GRAY);
        msg(p, String.format("Can: %.0f/%.0f · Eyer: %s · Element: %s", d.base.getHealth(),
                d.base.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH).getValue(), d.hasSaddle() ? "var" : "yok", d.species.element), NamedTextColor.GRAY);
        msg(p, "Yemi: " + d.species.food.name().toLowerCase(Locale.ROOT), NamedTextColor.DARK_GRAY);
    }

    private void species(CommandSender s) {
        msg(s, "— Ejderha Türleri (" + Species.all().size() + ") —", NamedTextColor.GOLD);
        for (Species sp : Species.all()) {
            s.sendMessage(Component.text("• " + sp.name, sp.color)
                    .append(Component.text(" · " + sp.element + (sp.aggressive ? " · saldırgan" : " · uysal"), NamedTextColor.GRAY)));
            msg(s, "   " + sp.description, NamedTextColor.DARK_GRAY);
        }
    }

    private void give(CommandSender s, String[] a) {
        if (a.length < 2) { msg(s, "/ejder ver <tür|tür:pul|eşya> [oyuncu] [adet]", NamedTextColor.GRAY); return; }
        Player target = a.length > 2 ? Bukkit.getPlayerExact(a[2]) : (s instanceof Player p ? p : null);
        if (target == null) { msg(s, "Oyuncu bulunamadı.", NamedTextColor.RED); return; }
        int amount = a.length > 3 ? parseInt(a[3], 1) : 1;
        String key = a[1].toLowerCase(Locale.ROOT);
        ItemStack it = null;
        if (key.endsWith(":pul")) {
            Species sp = Species.get(key.substring(0, key.length() - 4));
            if (sp != null) it = Items.scale(sp, amount);
        } else if (Species.get(key) != null) {
            it = Items.egg(Species.get(key));
            it.setAmount(Math.min(16, amount));
        } else {
            Supplier<ItemStack> sup = Items.SIMPLE.get(key);
            if (sup != null) { it = sup.get(); it.setAmount(Math.min(it.getMaxStackSize(), amount)); }
        }
        if (it == null) { msg(s, "Bilinmeyen tür/eşya: " + key, NamedTextColor.RED); return; }
        target.getInventory().addItem(it).values().forEach(rest -> target.getWorld().dropItem(target.getLocation(), rest));
        msg(s, target.getName() + " oyuncusuna verildi: " + key + " x" + amount, NamedTextColor.GREEN);
    }

    private void spawn(CommandSender s, String[] a) {
        if (a.length < 2) { msg(s, "/ejder dogur <tür> [yavru|genc|yetiskin] [evcil]", NamedTextColor.GRAY); return; }
        Species sp = Species.get(a[1]);
        if (sp == null) { msg(s, "Bilinmeyen tür.", NamedTextColor.RED); return; }
        double g = 1.0;
        if (a.length > 2) g = switch (a[2].toLowerCase(Locale.ROOT)) { case "yavru" -> 0; case "genc" -> 0.65; default -> 1.0; };
        Player p = s instanceof Player pl ? pl : null;
        boolean tame = p != null && a.length > 3 && a[3].equalsIgnoreCase("evcil");
        org.bukkit.Location at = p != null ? p.getLocation().add(p.getLocation().getDirection().setY(0).normalize().multiply(4))
                : Bukkit.getWorlds().get(0).getSpawnLocation().add(ThreadLocalRandomHolder.r(), 0, ThreadLocalRandomHolder.r());
        Dragon d = plugin.dragons().spawn(sp, at, tame ? p : null, g);
        if (d != null && tame) d.setSaddle(g >= 0.6);
        msg(s, sp.name + " doğdu.", NamedTextColor.GREEN);
    }

    private void clear(CommandSender s) {
        int n = 0;
        for (Dragon d : new ArrayList<>(plugin.dragons().loaded())) {
            if (d.isTamed()) continue;
            if (s instanceof Player p && (d.base.getWorld() != p.getWorld() || d.base.getLocation().distanceSquared(p.getLocation()) > 128 * 128)) continue;
            plugin.dragons().detach(d);
            d.base.remove();
            n++;
        }
        msg(s, n + " vahşi ejderha kaldırıldı.", NamedTextColor.GREEN);
    }

    private static final class ThreadLocalRandomHolder {
        static double r() { return java.util.concurrent.ThreadLocalRandom.current().nextDouble(-6, 6); }
    }

    private static int parseInt(String s, int def) { try { return Integer.parseInt(s); } catch (NumberFormatException e) { return def; } }

    private static String join(String[] a, int from) {
        StringBuilder b = new StringBuilder();
        for (int i = from; i < a.length; i++) { if (i > from) b.append(' '); b.append(a[i]); }
        return b.toString();
    }

    @Override
    public List<String> onTabComplete(CommandSender s, Command cmd, String label, String[] a) {
        List<String> out = new ArrayList<>();
        boolean admin = s.hasPermission("karia.ejder.admin");
        if (a.length == 1) {
            out.addAll(List.of("liste", "cagir", "gonder", "bilgi", "turler", "ada", "demir", "yardim"));
            if (admin) out.addAll(List.of("ver", "dogur", "temizle", "yenile"));
        } else if (a.length == 2 && (a[0].equalsIgnoreCase("ver") || a[0].equalsIgnoreCase("dogur")) && admin) {
            for (Species sp : Species.all()) { out.add(sp.id); if (a[0].equalsIgnoreCase("ver")) out.add(sp.id + ":pul"); }
            if (a[0].equalsIgnoreCase("ver")) out.addAll(Items.SIMPLE.keySet());
        } else if (a.length == 3 && a[0].equalsIgnoreCase("dogur")) {
            out.addAll(List.of("yavru", "genc", "yetiskin"));
        } else if (a.length == 4 && a[0].equalsIgnoreCase("dogur")) {
            out.add("evcil");
        } else if (a.length == 2 && a[0].equalsIgnoreCase("cagir") && s instanceof Player p) {
            for (var e : plugin.dragons().owned(p.getUniqueId())) if (e.name() != null) out.add(e.name());
        }
        String last = a[a.length - 1].toLowerCase(Locale.ROOT);
        out.removeIf(x -> !x.toLowerCase(Locale.ROOT).startsWith(last));
        return out;
    }
}
