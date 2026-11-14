package live.karia.ejderha;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Interaction;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Player;
import org.bukkit.entity.Wolf;
import org.bukkit.persistence.PersistentDataType;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/** Yüklü ejderhaları izler; doğal doğma, üreme, ahır (saklama) ve kayıt defteri burada. */
public final class DragonManager {
    private final KariaEjderha plugin;
    private final Map<UUID, Dragon> byBase = new HashMap<>();
    private final Map<UUID, Dragon> byPart = new HashMap<>();
    private final File file;
    private final YamlConfiguration reg;
    private boolean dirty;

    DragonManager(KariaEjderha plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "ejderhalar.yml");
        this.reg = YamlConfiguration.loadConfiguration(file);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tickAll, 1L, 1L);
        Bukkit.getScheduler().runTaskTimer(plugin, this::slowTick, 40L, 40L);
        Bukkit.getScheduler().runTaskTimer(plugin, this::naturalSpawn, 200L, 20L * plugin.getConfig().getLong("dogal-dogma.aralik-saniye", 30));
        Bukkit.getScheduler().runTaskTimer(plugin, () -> { if (dirty) save(); }, 1200L, 1200L);
    }

    // ------------------------------------------------------------------ izleme
    public boolean isDragon(Entity e) {
        return e instanceof Wolf && e.getPersistentDataContainer().has(plugin.kSpecies, PersistentDataType.STRING);
    }

    public Dragon attach(Wolf w) {
        Dragon d = byBase.get(w.getUniqueId());
        if (d != null) return d;
        Species s = Species.get(w.getPersistentDataContainer().get(plugin.kSpecies, PersistentDataType.STRING));
        if (s == null) return null;
        d = new Dragon(plugin, w, s);
        byBase.put(w.getUniqueId(), d);
        indexParts(d);
        remember(d);
        return d;
    }

    private void indexParts(Dragon d) {
        byPart.values().removeIf(x -> x == d);
        for (Entity e : d.displays()) byPart.put(e.getUniqueId(), d);
        if (d.hitbox() != null) byPart.put(d.hitbox().getUniqueId(), d);
    }

    public void detach(Dragon d) {
        if (!d.base.isDead()) remember(d);
        d.removeParts();
        byBase.remove(d.base.getUniqueId());
        byPart.values().removeIf(x -> x == d);
    }

    public Dragon byEntity(Entity e) {
        if (e == null) return null;
        Dragon d = byBase.get(e.getUniqueId());
        return d != null ? d : byPart.get(e.getUniqueId());
    }

    public Collection<Dragon> loaded() { return byBase.values(); }

    /** Yüklü dünyalardaki tüm ejderhaları bağlar (eklenti açılışı). */
    void scanAll() {
        for (World w : Bukkit.getWorlds()) {
            for (Entity e : w.getEntities()) {
                if (isDragon(e)) attach((Wolf) e);
                else if ((e instanceof ItemDisplay || e instanceof Interaction) && e.getPersistentDataContainer().has(plugin.kPart, PersistentDataType.STRING)) e.remove();
            }
        }
    }

    void shutdown() {
        for (Dragon d : new ArrayList<>(byBase.values())) {
            Player r = d.rider();
            if (r != null) { d.base.removePassenger(r); d.onDismount(r); }
            if (d.isFlying()) d.land();
            detach(d);
        }
        save();
    }

    private void tickAll() {
        for (Dragon d : new ArrayList<>(byBase.values())) {
            if (!d.base.isValid()) {
                if (d.base.isDead()) { forget(d); d.removeParts(); byBase.remove(d.base.getUniqueId()); byPart.values().removeIf(x -> x == d); }
                continue;
            }
            try { d.tick(); } catch (Throwable t) { plugin.getLogger().warning("Ejderha tick hatası: " + t); }
        }
    }

    private void slowTick() {
        for (Dragon d : new ArrayList<>(byBase.values())) {
            if (!d.base.isValid()) continue;
            d.ensureParts();
            indexParts(d);
            d.refreshGrowth();
        }
        breeding();
    }

    // ------------------------------------------------------------------ oluşturma
    public Dragon spawn(Species s, Location at, Player owner, double startGrowth) {
        long total = Math.max(1, plugin.getConfig().getLong("buyume-dakika", 90)) * 60_000L;
        long born = System.currentTimeMillis() - (long) (Math.max(0, Math.min(1, startGrowth)) * total);
        Wolf w = at.getWorld().spawn(at, Wolf.class, e -> {
            e.setInvisible(true);
            e.setSilent(true);
            e.setPersistent(true);
            e.setRemoveWhenFarAway(owner == null);
            e.setAdult();
            e.getPersistentDataContainer().set(plugin.kSpecies, PersistentDataType.STRING, s.id);
            e.getPersistentDataContainer().set(plugin.kBorn, PersistentDataType.LONG, born);
            if (owner != null) e.setOwner(owner);
        });
        Dragon d = attach(w);
        if (d != null) w.setHealth(w.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH).getValue());
        return d;
    }

    // ------------------------------------------------------------------ doğal doğma
    private void naturalSpawn() {
        List<String> worlds = plugin.getConfig().getStringList("dogal-dogma.dunyalar");
        if (worlds.isEmpty() || Species.all().isEmpty()) return;
        int cap = plugin.getConfig().getInt("dogal-dogma.dunya-basina-en-cok", 12);
        double chance = plugin.getConfig().getDouble("dogal-dogma.sans", 0.35);
        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        for (String wn : worlds) {
            World w = Bukkit.getWorld(wn);
            if (w == null) continue;
            long wild = byBase.values().stream().filter(d -> d.base.getWorld() == w && !d.isTamed()).count();
            if (wild >= cap) continue;
            for (Player p : w.getPlayers()) {
                if (wild >= cap || rnd.nextDouble() > chance) continue;
                boolean near = byBase.values().stream().anyMatch(d -> !d.isTamed() && d.base.getWorld() == w && d.base.getLocation().distanceSquared(p.getLocation()) < 96 * 96);
                if (near) continue;
                double ang = rnd.nextDouble(Math.PI * 2), dist = rnd.nextDouble(40, 80);
                Location l = p.getLocation().add(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
                if (!w.isChunkLoaded(l.getBlockX() >> 4, l.getBlockZ() >> 4)) continue;
                l.setY(w.getHighestBlockYAt(l) + 1);
                if (l.clone().subtract(0, 1, 0).getBlock().isLiquid() && rnd.nextInt(3) != 0) continue;
                String biome = l.getBlock().getBiome().getKey().getKey();
                Species s = pick(biome);
                if (s == null) continue;
                spawn(s, l, null, rnd.nextInt(4) == 0 ? 0.65 : 1.0);
                wild++;
            }
        }
    }

    private Species pick(String biome) {
        List<Species> ok = new ArrayList<>();
        int sum = 0;
        for (Species s : Species.all()) if (s.livesIn(biome)) { ok.add(s); sum += s.weight; }
        if (ok.isEmpty() || sum <= 0) return null;
        int r = ThreadLocalRandom.current().nextInt(sum);
        for (Species s : ok) { r -= s.weight; if (r < 0) return s; }
        return ok.get(0);
    }

    // ------------------------------------------------------------------ üreme
    private void breeding() {
        long cd = plugin.getConfig().getLong("ureme-bekleme-dakika", 20) * 60_000L;
        long now = System.currentTimeMillis();
        List<Dragon> love = new ArrayList<>();
        for (Dragon d : byBase.values()) if (d.inLove() && d.canFly() && d.isTamed()) love.add(d);
        for (int i = 0; i < love.size(); i++) {
            Dragon a = love.get(i);
            if (!a.inLove()) continue;
            for (int j = i + 1; j < love.size(); j++) {
                Dragon b = love.get(j);
                if (!b.inLove() || a.species != b.species || a.base.getWorld() != b.base.getWorld()) continue;
                if (a.base.getLocation().distanceSquared(b.base.getLocation()) > 10 * 10) continue;
                if (now < a.data().getOrDefault(plugin.kBred, PersistentDataType.LONG, 0L) + cd) continue;
                if (now < b.data().getOrDefault(plugin.kBred, PersistentDataType.LONG, 0L) + cd) continue;
                a.setInLove(false); b.setInLove(false);
                a.data().set(plugin.kBred, PersistentDataType.LONG, now);
                b.data().set(plugin.kBred, PersistentDataType.LONG, now);
                Location mid = a.base.getLocation().add(b.base.getLocation()).multiply(0.5).add(0, 0.5, 0);
                mid.getWorld().dropItemNaturally(mid, Items.egg(a.species));
                mid.getWorld().spawnParticle(org.bukkit.Particle.HEART, mid.clone().add(0, 1.5, 0), 12, 1, 0.5, 1, 0);
                a.sound(org.bukkit.Sound.ENTITY_ENDER_DRAGON_AMBIENT, 0.8f, 1.8f);
                Player o = Bukkit.getPlayer(a.owner());
                if (o != null) o.sendMessage(Items.t("✦ " + a.species.name + " ejderhaların bir yumurta bıraktı!", a.species.color));
                break;
            }
        }
    }

    // ------------------------------------------------------------------ kayıt defteri (sahipli ejderhalar)
    private String path(UUID owner, UUID dragon) { return "sahipler." + owner + "." + dragon; }

    public void remember(Dragon d) {
        if (!d.isTamed() || !d.base.isValid()) return;
        String p = path(d.owner(), d.base.getUniqueId());
        Location l = d.base.getLocation();
        reg.set(p + ".tur", d.species.id);
        reg.set(p + ".ad", d.displayName());
        reg.set(p + ".dogum", d.born());
        reg.set(p + ".eyer", d.hasSaddle());
        reg.set(p + ".ahir", false);
        reg.set(p + ".dunya", l.getWorld().getName());
        reg.set(p + ".x", l.getX()); reg.set(p + ".y", l.getY()); reg.set(p + ".z", l.getZ());
        dirty = true;
    }

    public void forget(Dragon d) {
        if (d.owner() == null) return;
        reg.set(path(d.owner(), d.base.getUniqueId()), null);
        dirty = true;
    }

    public record Entry(UUID id, String species, String name, boolean stabled, String world, double x, double y, double z, long born, boolean saddle) {}

    public List<Entry> owned(UUID owner) {
        List<Entry> out = new ArrayList<>();
        ConfigurationSection sec = reg.getConfigurationSection("sahipler." + owner);
        if (sec == null) return out;
        for (String k : sec.getKeys(false)) {
            ConfigurationSection e = sec.getConfigurationSection(k);
            if (e == null) continue;
            try {
                out.add(new Entry(UUID.fromString(k), e.getString("tur"), e.getString("ad"), e.getBoolean("ahir"),
                        e.getString("dunya"), e.getDouble("x"), e.getDouble("y"), e.getDouble("z"), e.getLong("dogum"), e.getBoolean("eyer")));
            } catch (IllegalArgumentException ignored) {}
        }
        return out;
    }

    public int countOwned(UUID owner) { return owned(owner).size(); }

    /** Ejderhayı ahıra koyar: varlık kaldırılır, bilgisi saklanır. */
    public void stable(Dragon d) {
        Player r = d.rider();
        if (r != null) { d.base.removePassenger(r); d.onDismount(r); }
        remember(d);
        reg.set(path(d.owner(), d.base.getUniqueId()) + ".ahir", true);
        reg.set(path(d.owner(), d.base.getUniqueId()) + ".can", d.base.getHealth());
        dirty = true;
        d.removeParts();
        byBase.remove(d.base.getUniqueId());
        byPart.values().removeIf(x -> x == d);
        d.base.remove();
    }

    /** Ahırdaki ejderhayı oyuncunun yanına çıkarır. */
    public Dragon unstable(Player p, Entry e) {
        Species s = Species.get(e.species());
        if (s == null) return null;
        String old = path(p.getUniqueId(), e.id());
        double hp = reg.getDouble(old + ".can", 0);
        reg.set(old, null);
        Location at = p.getLocation().add(p.getLocation().getDirection().setY(0).normalize().multiply(-2));
        Dragon d = spawn(s, at, p, 0);
        d.data().set(plugin.kBorn, PersistentDataType.LONG, e.born());
        d.setSaddle(e.saddle());
        if (e.name() != null && !e.name().equals(s.name)) d.base.customName(net.kyori.adventure.text.Component.text(e.name(), s.color));
        d.refreshGrowth();
        if (hp > 0) d.base.setHealth(Math.min(hp, d.base.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH).getValue()));
        remember(d);
        return d;
    }

    /** Dünyadaki (belki yüklü olmayan) ejderhayı oyuncuya getirir; sonucu callback ile bildirir. */
    public void summon(Player p, Entry e, java.util.function.Consumer<Dragon> done) {
        Entity ent = Bukkit.getEntity(e.id());
        if (ent instanceof Wolf w && isDragon(w)) { done.accept(bring(p, attach(w))); return; }
        World w = Bukkit.getWorld(e.world() == null ? "" : e.world());
        if (w == null) { done.accept(null); return; }
        w.getChunkAtAsync((int) Math.floor(e.x()) >> 4, (int) Math.floor(e.z()) >> 4).thenAccept(ch -> {
            ch.addPluginChunkTicket(plugin);
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                Entity x = Bukkit.getEntity(e.id());
                ch.removePluginChunkTicket(plugin);
                if (x instanceof Wolf wo && isDragon(wo)) done.accept(bring(p, attach(wo)));
                else done.accept(null);
            }, 10L);
        });
    }

    private Dragon bring(Player p, Dragon d) {
        if (d == null) return null;
        Player r = d.rider();
        if (r != null) { d.base.removePassenger(r); d.onDismount(r); }
        if (d.isFlying()) d.land();
        d.base.setSitting(false);
        Location at = p.getLocation().add(p.getLocation().getDirection().setY(0).normalize().multiply(-2));
        d.base.teleport(at);
        d.ensureParts();
        indexParts(d);
        remember(d);
        return d;
    }

    void save() {
        try { reg.save(file); dirty = false; }
        catch (IOException ex) { plugin.getLogger().warning("ejderhalar.yml kaydedilemedi: " + ex.getMessage()); }
    }
}
