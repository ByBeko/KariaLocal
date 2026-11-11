package live.karia.ejderha;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Bedrock (Geyser/Floodgate) oyuncuları için görünüm.
 * Bedrock'ta ItemDisplay yoktur; bu yüzden Bedrock oyuncularından 4 parçalı Java modeli gizlenir ve onlara yalnızca
 * kendilerine görünen bir zırh askısı gösterilir. Askının başındaki eşya (karia:ejder/&lt;tür&gt;/bedrock) Geyser eşleme
 * dosyasıyla Bedrock özel eşyasına, Bedrock kaynak paketindeki "attachable" ile 3B ejderha modeline dönüşür.
 */
public final class BedrockBridge implements Listener {
    private final KariaEjderha plugin;
    private final Map<Dragon, ArmorStand> stands = new HashMap<>();
    private Object floodgate;
    private Method isFloodgate;

    BedrockBridge(KariaEjderha plugin) {
        this.plugin = plugin;
        try {
            Class<?> c = Class.forName("org.geysermc.floodgate.api.FloodgateApi");
            floodgate = c.getMethod("getInstance").invoke(null);
            isFloodgate = c.getMethod("isFloodgatePlayer", UUID.class);
            plugin.getLogger().info("Floodgate bulundu: Bedrock görünümü açık.");
        } catch (Throwable ignored) {
            floodgate = null;
        }
    }

    public boolean enabled() { return plugin.getConfig().getBoolean("bedrock.acik", true); }

    public boolean isBedrock(Player p) {
        if (floodgate != null) {
            try { return (boolean) isFloodgate.invoke(floodgate, p.getUniqueId()); } catch (Throwable ignored) {}
        }
        return p.getUniqueId().getMostSignificantBits() == 0L; // Floodgate UUID biçimi
    }

    void onPartsSpawned(Dragon d, List<ItemDisplay> parts) {
        if (!enabled() || floodgate == null) return; // Floodgate yoksa Bedrock oyuncusu da yok
        ArmorStand old = stands.remove(d);
        if (old != null && old.isValid()) old.remove();
        ArmorStand st = d.base.getWorld().spawn(d.base.getLocation(), ArmorStand.class, a -> {
            a.setPersistent(false);
            a.setVisibleByDefault(false);
            a.setInvisible(true);
            a.setMarker(true);
            a.setGravity(false);
            a.setSilent(true);
            a.setBasePlate(false);
            a.setDisabledSlots(EquipmentSlot.values());
            a.getEquipment().setHelmet(model(d));
            a.getPersistentDataContainer().set(plugin.kPart, PersistentDataType.STRING, d.base.getUniqueId().toString());
        });
        stands.put(d, st);
        for (Player p : Bukkit.getOnlinePlayers()) apply(p, d, parts, st);
    }

    private ItemStack model(Dragon d) {
        ItemStack it = new ItemStack(Material.PAPER);
        ItemMeta m = it.getItemMeta();
        m.setItemModel(new NamespacedKey("karia", d.species.model("bedrock")));
        it.setItemMeta(m);
        return it;
    }

    private void apply(Player p, Dragon d, List<ItemDisplay> parts, ArmorStand st) {
        if (isBedrock(p)) {
            for (Entity e : parts) p.hideEntity(plugin, e);
            if (st != null) p.showEntity(plugin, st);
        }
    }

    void onVisualUpdate(Dragon d, Location l, float yaw) {
        ArmorStand st = stands.get(d);
        if (st == null) return;
        if (!st.isValid()) { stands.remove(d); return; }
        Location at = l.clone();
        at.setYaw(yaw);
        st.teleport(at);
        AttributeInstance sc = st.getAttribute(Attribute.SCALE);
        double want = d.visualScale();
        if (sc != null && Math.abs(sc.getBaseValue() - want) > 0.01) sc.setBaseValue(want);
    }

    void remove(Dragon d) {
        ArmorStand st = stands.remove(d);
        if (st != null && st.isValid()) st.remove();
    }

    void removeAll() {
        for (ArmorStand st : stands.values()) if (st.isValid()) st.remove();
        stands.clear();
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        if (!enabled() || !isBedrock(e.getPlayer())) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            for (Dragon d : plugin.dragons().loaded()) apply(e.getPlayer(), d, d.displays(), stands.get(d));
        }, 20L);
    }
}
