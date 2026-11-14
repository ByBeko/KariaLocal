package live.karia.ejderha;

import io.papermc.paper.event.player.PrePlayerAttackEntityEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Wolf;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityDismountEvent;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.bukkit.event.player.PlayerInteractAtEntityEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.event.world.EntitiesUnloadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

import java.util.concurrent.ThreadLocalRandom;

public final class DragonListener implements Listener {
    private final KariaEjderha plugin;
    private final DragonManager dm;

    DragonListener(KariaEjderha plugin) {
        this.plugin = plugin;
        this.dm = plugin.dragons();
    }

    // ------------------------------------------------------------------ yükleme
    @EventHandler
    public void onLoad(EntitiesLoadEvent e) {
        for (Entity en : e.getEntities()) if (dm.isDragon(en)) dm.attach((Wolf) en);
    }

    @EventHandler
    public void onUnload(EntitiesUnloadEvent e) {
        for (Entity en : e.getEntities()) {
            Dragon d = dm.byEntity(en);
            if (d != null && en == d.base) dm.detach(d);
        }
    }

    // ------------------------------------------------------------------ sağ tık
    @EventHandler(priority = EventPriority.LOW)
    public void onInteractAt(PlayerInteractAtEntityEvent e) {
        if (dm.byEntity(e.getRightClicked()) != null) e.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOW)
    public void onInteract(PlayerInteractEntityEvent e) {
        Dragon d = dm.byEntity(e.getRightClicked());
        if (d == null) return;
        e.setCancelled(true);
        if (e.getHand() != EquipmentSlot.HAND) return;
        Player p = e.getPlayer();
        ItemStack hand = p.getInventory().getItemInMainHand();
        String id = Items.idOf(hand);

        if (!d.isTamed()) {
            if (hand.getType() == d.species.food && id == null) tameAttempt(p, d, hand);
            else p.sendActionBar(Items.t(d.species.name + " · evcilleştirmek için " + foodName(d.species.food) + " ver", d.species.color));
            return;
        }
        boolean mine = p.getUniqueId().equals(d.owner());
        if (!mine) {
            p.sendActionBar(Items.t("Bu ejderha başkasına ait.", NamedTextColor.RED));
            return;
        }
        if (hand.getType() == d.species.food && id == null) { feed(p, d, hand); return; }
        if ("eyer".equals(id)) {
            if (d.hasSaddle()) { p.sendActionBar(Items.t("Ejderhanda zaten eyer var.", NamedTextColor.GRAY)); return; }
            if (!d.canRide()) { p.sendActionBar(Items.t("Yavru ejderhaya eyer takılamaz, büyümesini bekle.", NamedTextColor.GRAY)); return; }
            hand.subtract();
            d.setSaddle(true);
            d.sound(Sound.ENTITY_HORSE_SADDLE, 1f, 0.8f);
            dm.remember(d);
            return;
        }
        if (hand.getType() == Material.NAME_TAG && hand.getItemMeta().hasDisplayName()) {
            d.base.customName(hand.getItemMeta().displayName().color(d.species.color));
            d.base.setCustomNameVisible(true);
            hand.subtract();
            dm.remember(d);
            return;
        }
        if (p.isSneaking()) {
            if (d.hasSaddle() && hand.getType() == Material.SHEARS) {
                d.setSaddle(false);
                d.base.getWorld().dropItemNaturally(d.base.getLocation(), Items.saddle());
                dm.remember(d);
                return;
            }
            d.base.setSitting(!d.base.isSitting());
            p.sendActionBar(Items.t(d.displayName() + (d.base.isSitting() ? " oturuyor." : " seni takip ediyor."), d.species.color));
            return;
        }
        if (!d.hasSaddle()) { p.sendActionBar(Items.t("Binmek için önce Ejderha Eyeri tak.", NamedTextColor.GRAY)); return; }
        if (!d.canRide()) { p.sendActionBar(Items.t("Bu ejderha binmek için henüz çok küçük.", NamedTextColor.GRAY)); return; }
        d.mount(p);
        p.sendActionBar(Items.t("Zıpla: havalan · Eğil: alçal / in · Sol tık: nefes", d.species.color));
    }

    private void tameAttempt(Player p, Dragon d, ItemStack hand) {
        int max = plugin.getConfig().getInt("oyuncu-basina-en-cok", 4);
        if (dm.countOwned(p.getUniqueId()) >= max && !p.hasPermission("karia.ejder.sinirsiz")) {
            p.sendActionBar(Items.t("En fazla " + max + " ejderhan olabilir.", NamedTextColor.RED));
            return;
        }
        hand.subtract();
        Location l = d.base.getLocation().add(0, d.visualScale(), 0);
        if (ThreadLocalRandom.current().nextDouble() < plugin.getConfig().getDouble("evcillestirme-sansi", 0.2)) {
            d.base.setTarget(null);
            d.base.setAngry(false);
            d.base.setOwner(p);
            d.base.setRemoveWhenFarAway(false);
            d.base.setPersistent(true);
            if (d.isFlying()) d.land();
            l.getWorld().spawnParticle(Particle.HEART, l, 10, 0.8, 0.5, 0.8, 0);
            d.sound(Sound.ENTITY_ENDER_DRAGON_AMBIENT, 1f, 1.7f);
            p.sendMessage(Items.t("✦ " + d.species.name + " seni sahibi olarak kabul etti! Eyer takıp binebilirsin.", d.species.color));
            dm.remember(d);
        } else {
            l.getWorld().spawnParticle(Particle.SMOKE, l, 8, 0.5, 0.3, 0.5, 0.01);
            d.sound(Sound.ENTITY_ENDER_DRAGON_HURT, 0.5f, 1.8f);
        }
    }

    private void feed(Player p, Dragon d, ItemStack hand) {
        double max = d.base.getAttribute(Attribute.MAX_HEALTH).getValue();
        hand.subtract();
        Location l = d.base.getLocation().add(0, d.visualScale(), 0);
        if (d.base.getHealth() < max) {
            d.base.setHealth(Math.min(max, d.base.getHealth() + 12));
            l.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, l, 8, 0.6, 0.4, 0.6, 0);
        } else if (d.canFly()) {
            d.setInLove(true);
            l.getWorld().spawnParticle(Particle.HEART, l, 6, 0.6, 0.4, 0.6, 0);
        }
        d.sound(Sound.ENTITY_GENERIC_EAT, 1f, 0.6f);
    }

    private static String foodName(Material m) {
        return switch (m) {
            case SALMON -> "çiğ somon";
            case COD -> "çiğ morina";
            case RABBIT -> "çiğ tavşan";
            case SPIDER_EYE -> "örümcek gözü";
            case CHICKEN -> "çiğ tavuk";
            case MUTTON -> "çiğ koyun eti";
            case TROPICAL_FISH -> "tropik balık";
            case GOLDEN_CARROT -> "altın havuç";
            default -> m.name().toLowerCase().replace('_', ' ');
        };
    }

    // ------------------------------------------------------------------ eşya kullanımı (yumurta, düdük) ve havadan nefes
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = false)
    public void onUse(PlayerInteractEvent e) {
        Player p = e.getPlayer();
        Dragon riding = p.getVehicle() == null ? null : dm.byEntity(p.getVehicle());
        if (riding != null && (e.getAction() == Action.LEFT_CLICK_AIR || e.getAction() == Action.LEFT_CLICK_BLOCK)) {
            e.setCancelled(true);
            breath(p, riding);
            return;
        }
        if (e.getHand() != EquipmentSlot.HAND) return;
        if (e.getAction() != Action.RIGHT_CLICK_AIR && e.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        ItemStack it = e.getItem();
        String id = Items.idOf(it);
        if (id == null) return;
        switch (id) {
            case "yumurta", "pul" -> {
                e.setCancelled(true);
                if (id.equals("yumurta") && e.getAction() == Action.RIGHT_CLICK_BLOCK && e.getClickedBlock() != null) hatch(p, it, e.getClickedBlock());
            }
            case "duduk" -> { e.setCancelled(true); whistle(p); }
            case "eyer" -> e.setCancelled(true);
            default -> {}
        }
    }

    private void hatch(Player p, ItemStack it, Block clicked) {
        Species s = Items.speciesOf(it);
        if (s == null) return;
        int max = plugin.getConfig().getInt("oyuncu-basina-en-cok", 4);
        if (dm.countOwned(p.getUniqueId()) >= max && !p.hasPermission("karia.ejder.sinirsiz")) {
            p.sendActionBar(Items.t("En fazla " + max + " ejderhan olabilir. /ejder gonder ile ahıra koyabilirsin.", NamedTextColor.RED));
            return;
        }
        Location at = clicked.getLocation().add(0.5, 1, 0.5);
        if (!at.getBlock().isPassable()) { p.sendActionBar(Items.t("Burada yer yok.", NamedTextColor.RED)); return; }
        it.subtract();
        at.getWorld().spawnParticle(Particle.BLOCK, at, 30, 0.3, 0.3, 0.3, 0.1, Material.TURTLE_EGG.createBlockData());
        at.getWorld().playSound(at, Sound.ENTITY_TURTLE_EGG_HATCH, 1f, 0.7f);
        Dragon d = dm.spawn(s, at, p, 0);
        if (d != null) p.sendMessage(Items.t("✦ Yumurta çatladı! Yavru " + s.name + " artık senin. " + plugin.getConfig().getLong("buyume-dakika", 90) + " dakikada büyür.", s.color));
    }

    private void whistle(Player p) {
        if (p.hasCooldown(Material.STICK)) return;
        p.setCooldown(Material.STICK, 40);
        p.getWorld().playSound(p.getLocation(), Sound.ITEM_GOAT_HORN_SOUND_2, 1f, 1.6f);
        if (p.isSneaking()) {
            int n = 0;
            for (Dragon d : dm.loaded()) if (d.isTamed() && p.getUniqueId().equals(d.owner()) && d.rider() == null
                    && d.base.getWorld() == p.getWorld() && d.base.getLocation().distanceSquared(p.getLocation()) < 64 * 64) {
                d.base.setSitting(!d.base.isSitting());
                n++;
            }
            p.sendActionBar(Items.t(n == 0 ? "Yakında ejderhan yok." : n + " ejderhanın duruşu değişti.", NamedTextColor.GOLD));
            return;
        }
        Dragon best = null;
        double bd = Double.MAX_VALUE;
        for (Dragon d : dm.loaded()) {
            if (!d.isTamed() || !p.getUniqueId().equals(d.owner()) || d.base.getWorld() != p.getWorld() || d.rider() != null) continue;
            double dist = d.base.getLocation().distanceSquared(p.getLocation());
            if (dist < bd) { bd = dist; best = d; }
        }
        if (best == null) { p.sendActionBar(Items.t("Bu dünyada yüklü ejderhan yok. /ejder cagir dene.", NamedTextColor.GRAY)); return; }
        best.base.setSitting(false);
        if (bd > 20 * 20) best.base.teleport(p.getLocation().add(p.getLocation().getDirection().setY(0).normalize().multiply(-2)));
        else best.base.getPathfinder().moveTo(p.getLocation(), 1.4);
        p.sendActionBar(Items.t(best.displayName() + " geliyor!", best.species.color));
    }

    private void breath(Player p, Dragon d) {
        if (!p.getUniqueId().equals(d.owner())) return;
        long left = d.cooldownLeft();
        if (left > 0) { p.sendActionBar(Items.t("Nefes dolduruluyor… " + String.format("%.1f", left / 1000.0) + " sn", NamedTextColor.GRAY)); return; }
        d.breathe(p.getLocation().getDirection(), p);
    }

    @EventHandler(priority = EventPriority.LOW)
    public void onAttackEntity(PrePlayerAttackEntityEvent e) {
        Player p = e.getPlayer();
        Dragon riding = p.getVehicle() == null ? null : dm.byEntity(p.getVehicle());
        Dragon target = dm.byEntity(e.getAttacked());
        if (riding != null && (target == riding || target == null)) {
            if (target == riding) { e.setCancelled(true); breath(p, riding); }
            return;
        }
        if (target == null || e.getAttacked() == target.base) return;
        // Interaction'a vuruldu: hasarı tabana aktar
        e.setCancelled(true);
        if (target.isTamed() && p.getUniqueId().equals(target.owner())) return;
        double dmg = p.getAttribute(Attribute.ATTACK_DAMAGE) == null ? 1 : p.getAttribute(Attribute.ATTACK_DAMAGE).getValue();
        if (p.getAttackCooldown() < 0.9f) dmg *= 0.3;
        p.resetCooldown();
        target.base.damage(dmg, p);
    }

    // ------------------------------------------------------------------ inme
    @EventHandler
    public void onDismount(EntityDismountEvent e) {
        if (!(e.getEntity() instanceof Player p)) return;
        Dragon d = dm.byEntity(e.getDismounted());
        if (d == null) return;
        if (d.isFlying() && !d.base.isOnGround() && !d.base.isInWater() && e.isCancellable() && p.isOnline() && !p.isDead()) {
            e.setCancelled(true); // havada eğilmek = alçalmak
            return;
        }
        d.onDismount(p);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        Entity v = e.getPlayer().getVehicle();
        Dragon d = v == null ? null : dm.byEntity(v);
        if (d != null) { d.base.removePassenger(e.getPlayer()); d.onDismount(e.getPlayer()); }
    }

    // ------------------------------------------------------------------ hasar
    @EventHandler(ignoreCancelled = true)
    public void onDamage(EntityDamageEvent e) {
        Entity en = e.getEntity();
        Dragon d = dm.byEntity(en);
        if (d != null) {
            if (en != d.base) { e.setCancelled(true); return; }
            switch (e.getCause()) {
                case FALL, SUFFOCATION, FLY_INTO_WALL, CRAMMING -> { e.setCancelled(true); return; }
                case FIRE, FIRE_TICK, LAVA, HOT_FLOOR -> { if (d.species.element == Species.Element.ATES) { e.setCancelled(true); d.base.setFireTicks(0); return; } }
                case FREEZE -> { if (d.species.element == Species.Element.BUZ) { e.setCancelled(true); return; } }
                case POISON -> { if (d.species.element == Species.Element.ZEHIR) { e.setCancelled(true); return; } }
                case DROWNING -> { if (d.species.element == Species.Element.SU) { e.setCancelled(true); return; } }
                default -> {}
            }
            if (e instanceof EntityDamageByEntityEvent be) {
                Entity src = be.getDamager() instanceof Projectile pr && pr.getShooter() instanceof Entity sh ? sh : be.getDamager();
                if (d.isTamed() && src.getUniqueId().equals(d.owner())) { e.setCancelled(true); return; }
                if (src == d.rider()) { e.setCancelled(true); return; }
            }
            d.sound(Sound.ENTITY_ENDER_DRAGON_HURT, 0.6f, (float) (1.8 - d.species.size * 0.3));
            return;
        }
        // binici düşme hasarı almaz
        if (en instanceof Player p && e.getCause() == EntityDamageEvent.DamageCause.FALL && p.getVehicle() != null && dm.byEntity(p.getVehicle()) != null)
            e.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onTarget(EntityTargetLivingEntityEvent e) {
        Dragon d = dm.byEntity(e.getEntity());
        if (d != null && d.rider() != null) e.setCancelled(true);
    }

    @EventHandler
    public void onDeath(EntityDeathEvent e) {
        Dragon d = dm.byEntity(e.getEntity());
        if (d == null || e.getEntity() != d.base) return;
        e.getDrops().clear();
        e.setDroppedExp(d.canFly() ? 60 : 20);
        ThreadLocalRandom r = ThreadLocalRandom.current();
        int scales = (int) Math.round((2 + r.nextInt(4)) * Math.max(0.3, d.growth()));
        if (scales > 0) e.getDrops().add(Items.scale(d.species, scales));
        if (!d.isTamed() && d.canFly() && r.nextDouble() < plugin.getConfig().getDouble("vahsi-yumurta-sansi", 0.08))
            e.getDrops().add(Items.egg(d.species));
        if (d.isTamed()) {
            org.bukkit.entity.Player o = org.bukkit.Bukkit.getPlayer(d.owner());
            if (o != null) o.sendMessage(Component.text("✝ " + d.displayName() + " öldü.", NamedTextColor.RED));
        }
        Player r2 = d.rider();
        if (r2 != null) d.onDismount(r2);
        dm.forget(d);
        dm.detach(d);
    }
}
