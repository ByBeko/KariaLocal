package live.karia.ejderha;

import org.bukkit.NamespacedKey;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * KariaEjderha — Karia'nın özgün ejderha ve Viking içeriği.
 * Türler: plugins/KariaEjderha/turler.json · Ayarlar: config.yml · Sahipli ejderha kaydı: ejderhalar.yml
 */
public final class KariaEjderha extends JavaPlugin {
    public NamespacedKey kSpecies, kBorn, kSaddle, kBred, kPart;
    private DragonManager dragons;
    private BedrockBridge bedrock;

    @Override
    public void onEnable() {
        kSpecies = new NamespacedKey(this, "tur");
        kBorn = new NamespacedKey(this, "dogum");
        kSaddle = new NamespacedKey(this, "eyer");
        kBred = new NamespacedKey(this, "ureme");
        kPart = new NamespacedKey(this, "parca");

        saveDefaultConfig();
        if (!new File(getDataFolder(), "turler.json").exists()) saveResource("turler.json", false);
        loadSpecies();
        Items.init(this);
        Items.registerRecipes();

        bedrock = new BedrockBridge(this);
        dragons = new DragonManager(this);
        getServer().getPluginManager().registerEvents(new DragonListener(this), this);
        getServer().getPluginManager().registerEvents(bedrock, this);

        EjderCommand ec = new EjderCommand(this);
        PluginCommand c = getCommand("ejder");
        if (c != null) { c.setExecutor(ec); c.setTabCompleter(ec); }

        dragons.scanAll();
        getLogger().info(Species.all().size() + " ejderha türü yüklendi; " + dragons.loaded().size() + " ejderha bağlandı.");
    }

    @Override
    public void onDisable() {
        if (dragons != null) dragons.shutdown();
        if (bedrock != null) bedrock.removeAll();
    }

    private void loadSpecies() {
        File f = new File(getDataFolder(), "turler.json");
        try (Reader r = f.exists() ? Files.newBufferedReader(f.toPath(), StandardCharsets.UTF_8)
                : new InputStreamReader(getResource("turler.json"), StandardCharsets.UTF_8)) {
            Species.load(r);
        } catch (Exception ex) {
            getLogger().severe("turler.json okunamadı: " + ex.getMessage());
        }
    }

    void reloadAll() {
        reloadConfig();
        loadSpecies();
        Items.init(this);
        Items.registerRecipes();
    }

    public DragonManager dragons() { return dragons; }
    public BedrockBridge bedrock() { return bedrock; }
}
