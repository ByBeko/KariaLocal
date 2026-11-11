package live.karia.ejderha;

import org.bukkit.Input;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.GameMode;
import org.bukkit.entity.Interaction;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Wolf;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;
import org.joml.Matrix4f;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Dünyadaki tek bir ejderha.
 * Taban: görünmez, ölçeklenmiş bir kurt (yapay zekâ, can, evcilleşme, sahip takibi).
 * Görünüm: 4 ItemDisplay (gövde, baş, sol/sağ kanat) aynı model uzayında; animasyon = parça pivotu etrafında dönüş.
 * Tıklama: gövdeyi saran bir Interaction varlığı.
 */
public final class Dragon {
    // Model uzayındaki pivotlar (blok cinsinden, model merkezi (8,8,8)px = 0 noktası)
    private static final float[] PIV_HEAD = {0f, 0.25f, 0.375f};
    private static final float[] PIV_WING_L = {0.25f, 0.34375f, 0.125f};
    private static final float[] PIV_WING_R = {-0.25f, 0.34375f, 0.125f};

    public final KariaEjderha plugin;
    public final Wolf base;
    public final Species species;
    private ItemDisplay body, head, wingL, wingR;
    private Interaction hitbox;

    private boolean flying;
    private float bodyYaw, bodyPitch, fold = 1f;
    private int tick, wildFlyTicks;
    private Location flyTarget;
    private long nextBreath, loveUntil;
    private double growth = -1;
    private UUID hiddenFrom;

    Dragon(KariaEjderha plugin, Wolf base, Species species) {
        this.plugin = plugin;
        this.base = base;
        this.species = species;
        this.bodyYaw = base.getLocation().getYaw();
        this.tick = ThreadLocalRandom.current().nextInt(1000);
        spawnParts();
        refreshGrowth();
    }

    // ------------------------------------------------------------------ durum
    public PersistentDataContainer data() { return base.getPersistentDataContainer(); }
    public long born() { return data().getOrDefault(plugin.kBorn, PersistentDataType.LONG, 0L); }
    public boolean hasSaddle() { return data().getOrDefault(plugin.kSaddle, PersistentDataType.BYTE, (byte) 0) == 1; }
    public void setSaddle(boolean b) { data().set(plugin.kSaddle, PersistentDataType.BYTE, (byte) (b ? 1 : 0)); }
    public boolean isTamed() { return base.isTamed() && base.getOwnerUniqueId() != null; }
    public UUID owner() { return base.getOwnerUniqueId(); }
    public boolean isFlying() { return flying; }
    public double growth() { return growth; }
    public boolean canRide() { return growth >= 0.6; }
    public boolean canFly() { return growth >= 1.0; }
    public double visualScale() { return species.size * (0.35 + 0.65 * Math.min(1, growth)); }

    public String stageName() {
        if (growth >= 1) return "Yetişkin";
        if (growth >= 0.6) return "Genç";
        return "Yavru";
    }

    public String displayName() {
        String n = base.customName() == null ? null : net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(base.customName());
        return n == null || n.isBlank() ? species.name : n;
    }

    public Player rider() {
        for (Entity p : base.getPassengers()) if (p instanceof Player pl) return pl;
        return null;
    }

    public boolean inLove() { return System.currentTimeMillis() < loveUntil; }
    public void setInLove(boolean b) { loveUntil = b ? System.currentTimeMillis() + 30_000 : 0; }

    public boolean isPart(Entity e) {
        return e == base || e == hitbox || e == body || e == head || e == wingL || e == wingR;
    }

    /** Doğum zamanına göre büyüme oranı (0..1) ve buna bağlı özellikler. */
    public void refreshGrowth() {
        long total = Math.max(1, plugin.getConfig().getLong("buyume-dakika", 90)) * 60_000L;
        double g = Math.min(1.0, (System.currentTimeMillis() - born()) / (double) total);
        if (Math.abs(g - growth) < 0.01) return;
        growth = g;
        double s = visualScale();
        set(Attribute.SCALE, s * plugin.getConfig().getDouble("kurt-olcek", 1.0));
        double hpFactor = 0.4 + 0.6 * g;
        AttributeInstance hp = base.getAttribute(Attribute.MAX_HEALTH);
        if (hp != null) {
            double ratio = base.getHealth() / Math.max(1, hp.getValue());
            hp.setBaseValue(species.health * hpFactor);
            base.setHealth(Math.max(1, Math.min(hp.getValue(), ratio * hp.getValue())));
        }
        set(Attribute.ATTACK_DAMAGE, species.damage * hpFactor);
        set(Attribute.MOVEMENT_SPEED, species.walk);
        set(Attribute.STEP_HEIGHT, 1.0 + s * 0.4);
        if (hitbox != null) {
            hitbox.setInteractionWidth((float) (1.8 * s));
            hitbox.setInteractionHeight((float) (1.3 * s));
        }
    }

    private void set(Attribute a, double v) {
        AttributeInstance i = base.getAttribute(a);
        if (i != null) i.setBaseValue(v);
    }

    // ------------------------------------------------------------------ parçalar
    private ItemStack partItem(String part) {
        ItemStack it = new ItemStack(Material.PAPER);
        ItemMeta m = it.getItemMeta();
        m.setItemModel(new NamespacedKey("karia", species.model(part)));
        it.setItemMeta(m);
        return it;
    }

    private ItemDisplay spawnPart(String part) {
        Location l = base.getLocation();
        l.setYaw(0); l.setPitch(0);
        return base.getWorld().spawn(l, ItemDisplay.class, d -> {
            d.setPersistent(false);
            d.setItemStack(partItem(part));
            d.setItemDisplayTransform(ItemDisplay.ItemDisplayTransform.NONE);
            d.setTeleportDuration(2);
            d.setInterpolationDuration(2);
            d.setViewRange(2.0f);
            d.setShadowRadius(0f);
            d.getPersistentDataContainer().set(plugin.kPart, PersistentDataType.STRING, base.getUniqueId().toString());
        });
    }

    private void spawnParts() {
        body = spawnPart("govde");
        head = spawnPart("bas");
        wingL = spawnPart("kanat_sol");
        wingR = spawnPart("kanat_sag");
        hitbox = base.getWorld().spawn(base.getLocation(), Interaction.class, i -> {
            i.setPersistent(false);
            i.setResponsive(true);
            i.getPersistentDataContainer().set(plugin.kPart, PersistentDataType.STRING, base.getUniqueId().toString());
        });
        plugin.bedrock().onPartsSpawned(this, List.of(body, head, wingL, wingR));
    }

    public List<ItemDisplay> displays() { return List.of(body, head, wingL, wingR); }
    public Interaction hitbox() { return hitbox; }

    /** Parçaları kaldırır (taban kurt kalır). */
    public void removeParts() {
        for (Entity e : new Entity[]{body, head, wingL, wingR, hitbox}) if (e != null && e.isValid()) e.remove();
        plugin.bedrock().remove(this);
        hiddenFrom = null;
    }

    // ------------------------------------------------------------------ binme
    public void mount(Player p) {
        if (rider() != null) return;
        base.setSitting(false);
        base.addPassenger(p);
        base.setAware(false);
        p.hideEntity(plugin, hitbox);
        hiddenFrom = p.getUniqueId();
        bodyYaw = p.getYaw();
        sound(Sound.ENTITY_ENDER_DRAGON_GROWL, 0.5f, 1.6f);
    }

    /** Binici indiğinde (olay veya zorunlu). */
    public void onDismount(Player p) {
        base.setAware(true);
        if (hitbox != null) p.showEntity(plugin, hitbox);
        hiddenFrom = null;
        if (flying) land();
    }

    // ------------------------------------------------------------------ uçuş
    public void takeOff() {
        if (!canFly() || flying) return;
        flying = true;
        base.setGravity(false);
        base.setVelocity(base.getVelocity().setY(0.9));
        sound(Sound.ENTITY_ENDER_DRAGON_FLAP, 1.0f, 1.2f);
    }

    public void land() {
        flying = false;
        base.setGravity(true);
        base.setFallDistance(0);
        wildFlyTicks = 0;
        flyTarget = null;
    }

    // ------------------------------------------------------------------ her tick
    void tick() {
        tick++;
        Player r = rider();
        if (r != null) rideTick(r);
        else if (flying) {
            if (!isTamed() && wildFlyTicks > 0) wildFlyTick();
            else { // binici yok: süzülerek in
                base.setVelocity(base.getVelocity().multiply(0.85).setY(-0.35));
                if (base.isOnGround() || base.isInWater()) land();
            }
        } else if (!isTamed()) wildTick();

        // gövde yönü
        float target;
        if (r != null) target = r.getYaw();
        else {
            Vector v = base.getVelocity();
            if (v.getX() * v.getX() + v.getZ() * v.getZ() > 0.002) target = (float) Math.toDegrees(Math.atan2(-v.getX(), v.getZ()));
            else target = base.getBodyYaw();
        }
        bodyYaw += wrap(target - bodyYaw) * (r != null ? 0.45f : 0.2f);
        float pitchTarget = 0f;
        if (flying) {
            if (r != null) pitchTarget = clamp(r.getPitch() * 0.6f, -35, 35);
            else pitchTarget = clamp((float) (-base.getVelocity().getY() * 40), -30, 30);
        }
        bodyPitch += (pitchTarget - bodyPitch) * 0.25f;
        float foldTarget = flying ? 0f : 1f;
        fold += (foldTarget - fold) * 0.15f;

        if ((tick & 1) == 0) updateVisual(r);
        if (flying && tick % 18 == 0) sound(Sound.ENTITY_ENDER_DRAGON_FLAP, 0.6f, (float) (1.6 - species.size * 0.25));
        if (!flying && tick % 400 == 0 && ThreadLocalRandom.current().nextInt(3) == 0)
            sound(Sound.ENTITY_ENDER_DRAGON_AMBIENT, 0.35f, (float) (1.9 - species.size * 0.3));
    }

    private void rideTick(Player r) {
        Input in = r.getCurrentInput();
        base.setFallDistance(0);
        r.setFallDistance(0);
        float yawRad = (float) Math.toRadians(r.getYaw());
        Vector fwdFlat = new Vector(-Math.sin(yawRad), 0, Math.cos(yawRad));
        Vector right = new Vector(-Math.cos(yawRad), 0, -Math.sin(yawRad));
        base.setRotation(r.getYaw(), 0);
        double mul = plugin.getConfig().getDouble("hiz-carpani", 1.0);

        if (flying) {
            double spd = species.fly * 0.9 * mul * (in.isSprint() ? 1.5 : 1.0);
            Vector look = r.getLocation().getDirection();
            Vector t = new Vector();
            if (in.isForward()) t.add(look.clone().multiply(spd));
            if (in.isBackward()) t.add(look.clone().multiply(-0.3 * spd));
            if (in.isLeft()) t.add(right.clone().multiply(-0.5 * spd));
            if (in.isRight()) t.add(right.clone().multiply(0.5 * spd));
            if (in.isJump()) t.setY(t.getY() + 0.55 * spd);
            if (in.isSneak()) t.setY(t.getY() - 0.7 * spd);
            if (t.lengthSquared() < 1e-4) t.setY(Math.sin(tick * 0.08) * 0.03); // havada asılı kal
            Vector v = base.getVelocity().multiply(0.82).add(t.multiply(0.18));
            if (base.getLocation().getY() > base.getWorld().getMaxHeight() + 20) v.setY(Math.min(0, v.getY()));
            base.setVelocity(v);
            if (in.isSneak() && (base.isOnGround() || base.isInWater())) land();
        } else {
            boolean water = base.isInWater();
            double w = species.walk * 0.9 * mul * (in.isSprint() ? 1.4 : 1.0);
            if (water) w *= species.element == Species.Element.SU ? 2.2 : 0.6;
            Vector mv = new Vector();
            if (in.isForward()) mv.add(fwdFlat.clone().multiply(w));
            if (in.isBackward()) mv.add(fwdFlat.clone().multiply(-0.4 * w));
            if (in.isLeft()) mv.add(right.clone().multiply(-0.6 * w));
            if (in.isRight()) mv.add(right.clone().multiply(0.6 * w));
            double y = base.getVelocity().getY();
            if (water && species.element == Species.Element.SU) y = (in.isJump() ? 0.25 : 0) - (in.isSneak() ? 0.25 : 0) + r.getLocation().getDirection().getY() * (in.isForward() ? w : 0);
            base.setVelocity(new Vector(mv.getX(), y, mv.getZ()));
            if (in.isJump()) {
                if (canFly() && !(water && species.element == Species.Element.SU)) takeOff();
                else if (base.isOnGround()) base.setVelocity(base.getVelocity().setY(0.55));
            }
        }
    }

    private void wildTick() {
        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        if (tick % 20 == 0 && species.aggressive && canRide() && base.getTarget() == null) {
            Player near = null;
            double best = 12 * 12;
            for (Player p : base.getWorld().getPlayers()) {
                if (p.getGameMode() == GameMode.CREATIVE || p.getGameMode() == GameMode.SPECTATOR) continue;
                double d = p.getLocation().distanceSquared(base.getLocation());
                if (d < best) { best = d; near = p; }
            }
            if (near != null) { base.setTarget(near); base.setAngry(true); }
        }
        LivingEntity t = base.getTarget();
        if (t != null && t.isValid() && canRide() && rnd.nextInt(30) == 0) {
            double d = t.getLocation().distance(base.getLocation());
            if (d > 3 && d < 14) breathe(t.getEyeLocation().toVector().subtract(mouth().toVector()).normalize(), null);
        }
        if (canFly() && t == null && rnd.nextInt(1400) == 0) {
            takeOff();
            wildFlyTicks = 200 + rnd.nextInt(300);
            pickFlyTarget();
        }
    }

    private void pickFlyTarget() {
        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        Location l = base.getLocation().add(rnd.nextDouble(-30, 30), 0, rnd.nextDouble(-30, 30));
        World w = l.getWorld();
        l.setY(w.getHighestBlockYAt(l) + 12 + rnd.nextInt(18));
        flyTarget = l;
    }

    private void wildFlyTick() {
        wildFlyTicks--;
        if (flyTarget == null || flyTarget.distanceSquared(base.getLocation()) < 9) pickFlyTarget();
        Vector dir = flyTarget.toVector().subtract(base.getLocation().toVector());
        if (wildFlyTicks < 60) dir.setY(-6); // inişe geç
        Vector v = base.getVelocity().multiply(0.88).add(dir.normalize().multiply(species.fly * 0.55 * 0.12));
        base.setVelocity(v);
        if (wildFlyTicks <= 0 || (wildFlyTicks < 60 && base.isOnGround())) land();
    }

    // ------------------------------------------------------------------ görünüm
    private void updateVisual(Player r) {
        Location l = base.getLocation();
        l.setYaw(0); l.setPitch(0);
        float s = (float) visualScale();
        float breath = (float) Math.sin(tick * 0.08) * 0.012f;
        Matrix4f root = new Matrix4f()
                .translate(0, 0.5f * s + (flying ? (float) Math.sin(tick * 0.2) * 0.08f * s : 0f), 0)
                .rotateY((float) -Math.toRadians(bodyYaw))
                .rotateX((float) Math.toRadians(bodyPitch))
                .scale(s, s * (1 + breath), s);

        float headPitch = r != null ? clamp((r.getPitch() - bodyPitch) * 0.5f, -25, 30) : (float) Math.sin(tick * 0.05) * 6f;
        float headYaw = (float) Math.sin(tick * 0.03) * (r != null ? 4f : 14f);
        Matrix4f mHead = new Matrix4f(root).translate(PIV_HEAD[0], PIV_HEAD[1], PIV_HEAD[2])
                .rotateY((float) Math.toRadians(headYaw)).rotateX((float) Math.toRadians(headPitch))
                .translate(-PIV_HEAD[0], -PIV_HEAD[1], -PIV_HEAD[2]);

        float flapAmp = flying ? (r != null && !r.getCurrentInput().isForward() ? 0.35f : 0.7f) : 0.05f;
        float flap = (float) Math.sin(tick * (flying ? 0.32 : 0.05)) * flapAmp;
        float z = (1 - fold) * (flap + 0.08f) + fold * 0.35f;
        float y = fold * 1.3f;
        Matrix4f mL = new Matrix4f(root).translate(PIV_WING_L[0], PIV_WING_L[1], PIV_WING_L[2])
                .rotateY(y).rotateZ(z).translate(-PIV_WING_L[0], -PIV_WING_L[1], -PIV_WING_L[2]);
        Matrix4f mR = new Matrix4f(root).translate(PIV_WING_R[0], PIV_WING_R[1], PIV_WING_R[2])
                .rotateY(-y).rotateZ(-z).translate(-PIV_WING_R[0], -PIV_WING_R[1], -PIV_WING_R[2]);

        place(body, l, root);
        place(head, l, mHead);
        place(wingL, l, mL);
        place(wingR, l, mR);
        if (hitbox != null && hitbox.isValid()) hitbox.teleport(base.getLocation());
        plugin.bedrock().onVisualUpdate(this, l, bodyYaw);
    }

    private static void place(ItemDisplay d, Location l, Matrix4f m) {
        if (d == null || !d.isValid()) return;
        d.teleport(l);
        d.setInterpolationDelay(0);
        d.setTransformationMatrix(m);
    }

    /** Parçalar dünyadan düştüyse (ör. /kill) yeniden kurar. */
    void ensureParts() {
        boolean ok = body != null && body.isValid() && head != null && head.isValid() && wingL != null && wingL.isValid()
                && wingR != null && wingR.isValid() && hitbox != null && hitbox.isValid();
        if (ok) {
            if (body.getWorld() != base.getWorld() || body.getLocation().distanceSquared(base.getLocation()) > 64) {
                removeParts();
                spawnParts();
                growth = -1;
                refreshGrowth();
            }
            return;
        }
        removeParts();
        spawnParts();
        growth = -1;
        refreshGrowth();
    }

    // ------------------------------------------------------------------ nefes
    public Location mouth() {
        double s = visualScale();
        double yaw = Math.toRadians(bodyYaw);
        double fwd = 1.5 * s;
        return base.getLocation().add(-Math.sin(yaw) * fwd, 0.95 * s, Math.cos(yaw) * fwd);
    }

    public long cooldownLeft() { return Math.max(0, nextBreath - System.currentTimeMillis()); }

    /** Element nefesi. source: binici (hasarı o yapmış sayılır) ya da null (ejderha). */
    public void breathe(Vector dir, Player source) {
        if (!canRide()) return;
        long now = System.currentTimeMillis();
        if (now < nextBreath) return;
        nextBreath = now + plugin.getConfig().getLong("nefes-bekleme-ms", 2500);
        double range = plugin.getConfig().getDouble("nefes-menzil", 12) * Math.min(1, 0.5 + growth * 0.5);
        double dmg = species.damage * (0.4 + 0.6 * growth) * plugin.getConfig().getDouble("nefes-hasar-carpani", 0.8);
        Location m = mouth();
        World w = m.getWorld();
        Set<UUID> hit = new HashSet<>();
        Entity damager = source != null ? source : base;
        effectSound(m);
        for (double i = 0.8; i <= range; i += 0.8) {
            Location p = m.clone().add(dir.clone().multiply(i));
            if (p.getBlock().getType().isOccluding()) { particles(p, 4); break; }
            particles(p, 2 + (int) (i / 3));
            double rad = 0.6 + i * 0.12;
            for (Entity e : w.getNearbyEntities(p, rad, rad, rad)) {
                if (!(e instanceof LivingEntity le) || e instanceof ArmorStand || !hit.add(e.getUniqueId())) continue;
                if (!validTarget(le, source)) continue;
                applyElement(le, dmg, damager, dir, source);
            }
            if (species.element == Species.Element.SIMSEK && i + 0.8 > range) w.strikeLightningEffect(p);
        }
    }

    private boolean validTarget(LivingEntity le, Player source) {
        if (le == base || le == source) return false;
        if (isTamed() && le.getUniqueId().equals(owner())) return false;
        if (le instanceof Player p && (p.getGameMode() == GameMode.CREATIVE || p.getGameMode() == GameMode.SPECTATOR)) return false;
        Dragon other = plugin.dragons().byEntity(le);
        if (other != null && isTamed() && owner().equals(other.owner())) return false;
        if (le instanceof Wolf wo && isTamed() && wo.isTamed() && owner().equals(wo.getOwnerUniqueId())) return false;
        return true;
    }

    private void applyElement(LivingEntity t, double dmg, Entity damager, Vector dir, Player source) {
        switch (species.element) {
            case ATES -> { t.damage(dmg, damager); t.setFireTicks(Math.max(t.getFireTicks(), 80)); }
            case BUZ -> {
                t.damage(dmg * 0.9, damager);
                t.setFreezeTicks(Math.min(t.getMaxFreezeTicks() + 120, t.getFreezeTicks() + 140));
                t.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, 80, 1));
            }
            case SIMSEK -> t.damage(dmg * 1.2, damager);
            case ZEHIR -> { t.damage(dmg * 0.6, damager); t.addPotionEffect(new PotionEffect(PotionEffectType.POISON, 100, 1)); }
            case GOLGE -> {
                t.damage(dmg * 0.8, damager);
                t.addPotionEffect(new PotionEffect(PotionEffectType.BLINDNESS, 60, 0));
                t.addPotionEffect(new PotionEffect(PotionEffectType.WITHER, 60, 0));
            }
            case TOPRAK -> { t.damage(dmg, damager); t.setVelocity(t.getVelocity().add(dir.clone().multiply(1.3).setY(0.45))); }
            case SU -> { t.damage(dmg * 0.8, damager); t.setFireTicks(0); t.setVelocity(t.getVelocity().add(dir.clone().multiply(1.0).setY(0.3))); }
            case ALTIN -> {
                t.damage(dmg * 0.7, damager);
                t.addPotionEffect(new PotionEffect(PotionEffectType.GLOWING, 200, 0));
                if (source != null) {
                    AttributeInstance mh = source.getAttribute(Attribute.MAX_HEALTH);
                    source.setHealth(Math.min(mh == null ? 20 : mh.getValue(), source.getHealth() + 2));
                }
            }
        }
    }

    private void particles(Location p, int n) {
        World w = p.getWorld();
        switch (species.element) {
            case ATES -> { w.spawnParticle(Particle.FLAME, p, n * 2, 0.25, 0.25, 0.25, 0.02); w.spawnParticle(Particle.SMOKE, p, n, 0.2, 0.2, 0.2, 0.01); }
            case BUZ -> { w.spawnParticle(Particle.SNOWFLAKE, p, n * 2, 0.3, 0.3, 0.3, 0.02); w.spawnParticle(Particle.CLOUD, p, n, 0.2, 0.2, 0.2, 0.01); }
            case SIMSEK -> { w.spawnParticle(Particle.ELECTRIC_SPARK, p, n * 3, 0.3, 0.3, 0.3, 0.1); w.spawnParticle(Particle.END_ROD, p, 1, 0.1, 0.1, 0.1, 0.01); }
            case ZEHIR -> { w.spawnParticle(Particle.ITEM_SLIME, p, n * 2, 0.3, 0.3, 0.3, 0.02); w.spawnParticle(Particle.SNEEZE, p, n, 0.2, 0.2, 0.2, 0.01); }
            case GOLGE -> { w.spawnParticle(Particle.SQUID_INK, p, n * 2, 0.3, 0.3, 0.3, 0.02); w.spawnParticle(Particle.PORTAL, p, n * 2, 0.3, 0.3, 0.3, 0.2); }
            case TOPRAK -> { w.spawnParticle(Particle.BLOCK, p, n * 3, 0.3, 0.3, 0.3, 0.1, Material.COARSE_DIRT.createBlockData()); w.spawnParticle(Particle.CAMPFIRE_COSY_SMOKE, p, 1, 0.1, 0.1, 0.1, 0.01); }
            case SU -> { w.spawnParticle(Particle.SPLASH, p, n * 4, 0.3, 0.3, 0.3, 0.1); w.spawnParticle(Particle.BUBBLE, p, n * 2, 0.3, 0.3, 0.3, 0.05); }
            case ALTIN -> { w.spawnParticle(Particle.WAX_ON, p, n * 2, 0.3, 0.3, 0.3, 0.5); w.spawnParticle(Particle.END_ROD, p, n, 0.2, 0.2, 0.2, 0.02); }
        }
    }

    private void effectSound(Location m) {
        Sound s = switch (species.element) {
            case ATES -> Sound.ENTITY_BLAZE_SHOOT;
            case BUZ -> Sound.ENTITY_PLAYER_HURT_FREEZE;
            case SIMSEK -> Sound.ENTITY_LIGHTNING_BOLT_THUNDER;
            case ZEHIR -> Sound.ENTITY_LLAMA_SPIT;
            case GOLGE -> Sound.ENTITY_PHANTOM_BITE;
            case TOPRAK -> Sound.ENTITY_RAVAGER_ROAR;
            case SU -> Sound.ITEM_BUCKET_EMPTY;
            case ALTIN -> Sound.BLOCK_AMETHYST_BLOCK_CHIME;
        };
        m.getWorld().playSound(m, s, SoundCategory.NEUTRAL, species.element == Species.Element.SIMSEK ? 0.5f : 1.2f, 1.0f);
        m.getWorld().playSound(m, Sound.ENTITY_ENDER_DRAGON_SHOOT, SoundCategory.NEUTRAL, 0.6f, 1.4f);
    }

    public void sound(Sound s, float vol, float pitch) {
        base.getWorld().playSound(base.getLocation(), s, SoundCategory.NEUTRAL, vol, pitch);
    }

    // ------------------------------------------------------------------ yardımcı
    private static float wrap(float a) {
        a %= 360f;
        if (a >= 180f) a -= 360f;
        if (a < -180f) a += 360f;
        return a;
    }

    private static float clamp(float v, float lo, float hi) { return Math.max(lo, Math.min(hi, v)); }
}
