package live.karia.ejderha;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Material;

import java.io.Reader;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Bir ejderha türü. Tüm türler turler.json'dan okunur; kodda sabit tür yoktur. */
public final class Species {
    public enum Element { ATES, BUZ, SIMSEK, ZEHIR, GOLGE, TOPRAK, SU, ALTIN }

    public final String id, name, description;
    public final TextColor color;
    public final Element element;
    public final boolean aggressive;
    public final int weight;
    public final double size, health, damage, walk, fly;
    public final Material food;
    public final List<String> biomes;

    private Species(JsonObject o) {
        id = o.get("id").getAsString().toLowerCase(Locale.ROOT);
        name = o.get("ad").getAsString();
        description = o.has("aciklama") ? o.get("aciklama").getAsString() : "";
        TextColor c = TextColor.fromHexString(o.has("renk") ? o.get("renk").getAsString() : "#ffffff");
        color = c == null ? TextColor.color(0xffffff) : c;
        element = Element.valueOf(o.get("element").getAsString().toUpperCase(Locale.ROOT));
        aggressive = o.has("saldirgan") && o.get("saldirgan").getAsBoolean();
        weight = o.has("agirlik") ? o.get("agirlik").getAsInt() : 10;
        size = o.get("boyut").getAsDouble();
        health = o.get("can").getAsDouble();
        damage = o.get("hasar").getAsDouble();
        walk = o.get("yurume").getAsDouble();
        fly = o.get("ucus").getAsDouble();
        Material f = Material.matchMaterial(o.get("yem").getAsString());
        food = f == null ? Material.COD : f;
        List<String> b = new ArrayList<>();
        if (o.has("biyomlar")) for (JsonElement e : o.getAsJsonArray("biyomlar")) b.add(e.getAsString().toLowerCase(Locale.ROOT));
        biomes = List.copyOf(b);
    }

    public boolean livesIn(String biomeKey) {
        for (String b : biomes) if (biomeKey.contains(b)) return true;
        return false;
    }

    /** item_model anahtarının ad kısmı, ör. "ejder/kor_kanat/govde" */
    public String model(String part) { return "ejder/" + id + "/" + part; }

    // ------------------------------------------------------------------ kayıt
    private static final Map<String, Species> ALL = new LinkedHashMap<>();

    public static void load(Reader r) {
        JsonObject root = JsonParser.parseReader(r).getAsJsonObject();
        JsonArray arr = root.getAsJsonArray("turler");
        ALL.clear();
        for (JsonElement e : arr) {
            Species s = new Species(e.getAsJsonObject());
            ALL.put(s.id, s);
        }
    }

    public static Species get(String id) { return id == null ? null : ALL.get(id.toLowerCase(Locale.ROOT)); }
    public static Collection<Species> all() { return ALL.values(); }
}
