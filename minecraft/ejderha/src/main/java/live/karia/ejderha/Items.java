package live.karia.ejderha;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.inventory.EquipmentSlotGroup;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.RecipeChoice;
import org.bukkit.inventory.ShapedRecipe;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.components.EquippableComponent;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Eklentinin tüm özel eşyaları. Görünüm kaynak paketinden gelir (item_model = karia:...).
 * Eşya kimliği PDC'de "karia_ejderha:esya", tür gerekiyorsa "karia_ejderha:tur" olarak durur.
 */
public final class Items {
    private Items() {}

    public static NamespacedKey ID, SPECIES;
    private static KariaEjderha plugin;

    /** Yönetici komutu ve tarifler için: id → üretici */
    public static final Map<String, Supplier<ItemStack>> SIMPLE = new LinkedHashMap<>();

    static void init(KariaEjderha p) {
        plugin = p;
        ID = new NamespacedKey(p, "esya");
        SPECIES = new NamespacedKey(p, "tur");
        SIMPLE.clear();
        SIMPLE.put("eyer", Items::saddle);
        SIMPLE.put("duduk", Items::whistle);
        SIMPLE.put("viking_baltasi", Items::vikingAxe);
        SIMPLE.put("savas_cekici", Items::warHammer);
        SIMPLE.put("pul_kilic", Items::scaleSword);
        SIMPLE.put("viking_migferi", () -> armor("viking_migferi", Material.IRON_HELMET, "Viking Miğferi", EquipmentSlotGroup.HEAD, 3));
        SIMPLE.put("viking_zirhi", () -> armor("viking_zirhi", Material.IRON_CHESTPLATE, "Viking Zırhı", EquipmentSlotGroup.CHEST, 7));
        SIMPLE.put("viking_tozlugu", () -> armor("viking_tozlugu", Material.IRON_LEGGINGS, "Viking Tozluğu", EquipmentSlotGroup.LEGS, 6));
        SIMPLE.put("viking_cizmesi", () -> armor("viking_cizmesi", Material.IRON_BOOTS, "Viking Çizmesi", EquipmentSlotGroup.FEET, 3));
    }

    // ------------------------------------------------------------------ yardımcılar
    static Component t(String s, TextColor c) {
        return Component.text(s, c).decoration(TextDecoration.ITALIC, false);
    }

    private static ItemStack make(Material base, String id, String model, Component name, List<Component> lore) {
        ItemStack it = new ItemStack(base);
        ItemMeta m = it.getItemMeta();
        m.displayName(name);
        m.lore(lore);
        m.setItemModel(new NamespacedKey("karia", model));
        m.getPersistentDataContainer().set(ID, PersistentDataType.STRING, id);
        it.setItemMeta(m);
        return it;
    }

    public static String idOf(ItemStack it) {
        if (it == null || !it.hasItemMeta()) return null;
        return it.getItemMeta().getPersistentDataContainer().get(ID, PersistentDataType.STRING);
    }

    public static Species speciesOf(ItemStack it) {
        if (it == null || !it.hasItemMeta()) return null;
        return Species.get(it.getItemMeta().getPersistentDataContainer().get(SPECIES, PersistentDataType.STRING));
    }

    private static ItemStack withSpecies(ItemStack it, Species s) {
        ItemMeta m = it.getItemMeta();
        m.getPersistentDataContainer().set(SPECIES, PersistentDataType.STRING, s.id);
        it.setItemMeta(m);
        return it;
    }

    // ------------------------------------------------------------------ ejderha eşyaları
    public static ItemStack egg(Species s) {
        List<Component> lore = new ArrayList<>();
        lore.add(t(s.description, NamedTextColor.GRAY));
        lore.add(Component.empty());
        lore.add(t("Bir bloğa sağ tıkla: yumurta çatlar", NamedTextColor.DARK_GRAY));
        lore.add(t("ve yavru ejderha senin olur.", NamedTextColor.DARK_GRAY));
        ItemStack it = make(Material.PAPER, "yumurta", s.model("yumurta"), t(s.name + " Yumurtası", s.color).decorate(TextDecoration.BOLD), lore);
        ItemMeta m = it.getItemMeta();
        m.setMaxStackSize(16);
        it.setItemMeta(m);
        return withSpecies(it, s);
    }

    public static ItemStack scale(Species s, int amount) {
        ItemStack it = make(Material.PAPER, "pul", s.model("pul"), t(s.name + " Pulu", s.color),
                List.of(t("Viking demircilerinin aradığı sert pul.", NamedTextColor.GRAY)));
        it.setAmount(amount);
        return withSpecies(it, s);
    }

    public static ItemStack saddle() {
        return make(Material.SADDLE, "eyer", "ejder/eyer", t("Ejderha Eyeri", TextColor.color(0xd9a066)).decorate(TextDecoration.BOLD),
                List.of(t("Evcil ejderhana sağ tıklayarak tak.", NamedTextColor.GRAY),
                        t("Eyerli ejderhaya binebilirsin.", NamedTextColor.GRAY)));
    }

    public static ItemStack whistle() {
        return make(Material.STICK, "duduk", "ejder/duduk", t("Ejderha Düdüğü", TextColor.color(0xe8d8b0)).decorate(TextDecoration.BOLD),
                List.of(t("Sağ tık: en yakın ejderhan yanına gelir.", NamedTextColor.GRAY),
                        t("Eğilip sağ tık: ejderhaların otursun / takip etsin.", NamedTextColor.GRAY)));
    }

    private static void weaponStats(ItemMeta m, String id, double damage, double speed) {
        m.addAttributeModifier(Attribute.ATTACK_DAMAGE, new AttributeModifier(new NamespacedKey(plugin, id + "_hasar"), damage - 1, AttributeModifier.Operation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
        m.addAttributeModifier(Attribute.ATTACK_SPEED, new AttributeModifier(new NamespacedKey(plugin, id + "_hiz"), speed - 4, AttributeModifier.Operation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
    }

    public static ItemStack vikingAxe() {
        ItemStack it = make(Material.IRON_AXE, "viking_baltasi", "ejder/viking_baltasi", t("Viking Baltası", TextColor.color(0xd0d6de)).decorate(TextDecoration.BOLD),
                List.of(t("Kuzey ormanlarının sert baltası.", NamedTextColor.GRAY), Component.empty(),
                        t("Hasar 10 · Hız 0.9", NamedTextColor.DARK_GRAY)));
        ItemMeta m = it.getItemMeta();
        weaponStats(m, "viking_baltasi", 10, 0.9);
        it.setItemMeta(m);
        return it;
    }

    public static ItemStack warHammer() {
        ItemStack it = make(Material.IRON_AXE, "savas_cekici", "ejder/savas_cekici", t("Savaş Çekici", TextColor.color(0xb8a58c)).decorate(TextDecoration.BOLD),
                List.of(t("Yavaş ama yere seren darbeler.", NamedTextColor.GRAY), Component.empty(),
                        t("Hasar 12 · Hız 0.7 · Geri itme", NamedTextColor.DARK_GRAY)));
        ItemMeta m = it.getItemMeta();
        weaponStats(m, "savas_cekici", 12, 0.7);
        m.addAttributeModifier(Attribute.ATTACK_KNOCKBACK, new AttributeModifier(new NamespacedKey(plugin, "savas_cekici_itme"), 1.0, AttributeModifier.Operation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
        it.setItemMeta(m);
        return it;
    }

    public static ItemStack scaleSword() {
        ItemStack it = make(Material.DIAMOND_SWORD, "pul_kilic", "ejder/pul_kilic", t("Pul Kılıç", TextColor.color(0x9ee7ff)).decorate(TextDecoration.BOLD),
                List.of(t("Ejderha pulu kaplı keskin kılıç.", NamedTextColor.GRAY), Component.empty(),
                        t("Hasar 8 · Hız 1.7", NamedTextColor.DARK_GRAY)));
        ItemMeta m = it.getItemMeta();
        weaponStats(m, "pul_kilic", 8, 1.7);
        it.setItemMeta(m);
        return it;
    }

    private static ItemStack armor(String id, Material base, String name, EquipmentSlotGroup slot, double armor) {
        ItemStack it = make(base, id, "ejder/" + id, t(name, TextColor.color(0xc9a46a)).decorate(TextDecoration.BOLD),
                List.of(t("Kürk ve demirle örülmüş Viking takımı.", NamedTextColor.GRAY), Component.empty(),
                        t("Zırh " + (int) armor + " · Dayanıklılık 1", NamedTextColor.DARK_GRAY)));
        ItemMeta m = it.getItemMeta();
        m.addAttributeModifier(Attribute.ARMOR, new AttributeModifier(new NamespacedKey(plugin, id + "_zirh"), armor, AttributeModifier.Operation.ADD_NUMBER, slot));
        m.addAttributeModifier(Attribute.ARMOR_TOUGHNESS, new AttributeModifier(new NamespacedKey(plugin, id + "_sertlik"), 1, AttributeModifier.Operation.ADD_NUMBER, slot));
        EquippableComponent eq = m.getEquippable();
        eq.setModel(new NamespacedKey("karia", "viking"));
        m.setEquippable(eq);
        it.setItemMeta(m);
        return it;
    }

    // ------------------------------------------------------------------ tarifler
    static void registerRecipes() {
        List<ItemStack> scales = new ArrayList<>();
        for (Species s : Species.all()) scales.add(scale(s, 1));
        if (scales.isEmpty()) return;
        RecipeChoice S = new RecipeChoice.ExactChoice(scales);

        shaped("eyer", saddle(), S, new String[]{"LSL", "LIL"}, 'L', Material.LEATHER, 'I', Material.IRON_INGOT);
        shaped("duduk", whistle(), S, new String[]{"  S", " B ", "B  "}, 'B', Material.BONE);
        shaped("viking_baltasi", vikingAxe(), S, new String[]{"IIS", "IB ", " B "}, 'I', Material.IRON_INGOT, 'B', Material.STICK);
        shaped("savas_cekici", warHammer(), S, new String[]{"III", "ISI", " B "}, 'I', Material.IRON_BLOCK, 'B', Material.STICK);
        shaped("pul_kilic", scaleSword(), S, new String[]{"S", "D", "B"}, 'D', Material.DIAMOND, 'B', Material.STICK);
        shaped("viking_migferi", SIMPLE.get("viking_migferi").get(), S, new String[]{"ISI", "L L"}, 'I', Material.IRON_INGOT, 'L', Material.LEATHER);
        shaped("viking_zirhi", SIMPLE.get("viking_zirhi").get(), S, new String[]{"L L", "ISI", "ILI"}, 'I', Material.IRON_INGOT, 'L', Material.LEATHER);
        shaped("viking_tozlugu", SIMPLE.get("viking_tozlugu").get(), S, new String[]{"ISI", "L L", "I I"}, 'I', Material.IRON_INGOT, 'L', Material.LEATHER);
        shaped("viking_cizmesi", SIMPLE.get("viking_cizmesi").get(), S, new String[]{"L L", "S S"}, 'L', Material.LEATHER);
    }

    private static void shaped(String id, ItemStack result, RecipeChoice scale, String[] shape, Object... ingredients) {
        NamespacedKey key = new NamespacedKey(plugin, id);
        Bukkit.removeRecipe(key);
        ShapedRecipe r = new ShapedRecipe(key, result);
        r.shape(shape);
        String all = String.join("", shape);
        if (all.indexOf('S') >= 0) r.setIngredient('S', scale);
        for (int i = 0; i + 1 < ingredients.length; i += 2) r.setIngredient((Character) ingredients[i], (Material) ingredients[i + 1]);
        Bukkit.addRecipe(r);
    }
}
