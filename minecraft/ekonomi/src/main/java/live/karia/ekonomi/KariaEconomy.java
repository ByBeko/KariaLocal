package live.karia.ekonomi;

import java.util.Collections;
import java.util.List;
import java.util.UUID;
import net.milkbowl.vault.economy.Economy;
import net.milkbowl.vault.economy.EconomyResponse;
import net.milkbowl.vault.economy.EconomyResponse.ResponseType;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;

/** Vault ekonomisi. Tutarlar tam sayıdır (botun cüzdanı tam sayı tutar). Çağrılar ana iş parçacığından gelir ve ağa çıkmaz. */
final class KariaEconomy implements Economy {
    private final KariaEkonomi plugin;

    KariaEconomy(KariaEkonomi plugin) { this.plugin = plugin; }

    /** Hesap anahtarı: oyuncu/kasaba UUID'si ya da adla açılmış hesap. */
    private String keyOf(OfflinePlayer p) { return Ledger.key(p.getUniqueId()); }

    private String keyOf(String name) {
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) return Ledger.key(online.getUniqueId());
        UUID known = plugin.ledger().names.get(name.toLowerCase(java.util.Locale.ROOT));
        return known != null ? Ledger.key(known) : Ledger.key(name);
    }

    static long amount(double d) { return Math.round(d); }

    // ── çekirdek ──
    double balance(String key) { return plugin.balanceOf(key); }

    EconomyResponse withdraw(String key, double d) {
        long a = amount(d);
        if (a < 0) return new EconomyResponse(0, balance(key), ResponseType.FAILURE, "Eksi miktar çekilemez.");
        if (a == 0) return new EconomyResponse(0, balance(key), ResponseType.SUCCESS, null);
        if (plugin.balanceOf(key) < a) return new EconomyResponse(0, balance(key), ResponseType.FAILURE, "Yetersiz bakiye.");
        plugin.change(key, -a, "Oyun içi harcama");
        return new EconomyResponse(a, balance(key), ResponseType.SUCCESS, null);
    }

    EconomyResponse deposit(String key, double d) {
        long a = amount(d);
        if (a < 0) return new EconomyResponse(0, balance(key), ResponseType.FAILURE, "Eksi miktar yatırılamaz.");
        if (a == 0) return new EconomyResponse(0, balance(key), ResponseType.SUCCESS, null);
        plugin.change(key, a, "Oyun içi kazanç");
        return new EconomyResponse(a, balance(key), ResponseType.SUCCESS, null);
    }

    // ── Vault ──
    @Override public boolean isEnabled() { return plugin.isEnabled(); }
    @Override public String getName() { return "KariaEkonomi"; }
    @Override public boolean hasBankSupport() { return false; }
    @Override public int fractionalDigits() { return 0; }
    @Override public String format(double v) { long a = amount(v); return a + " " + (a == 1 ? currencyNameSingular() : currencyNamePlural()); }
    @Override public String currencyNamePlural() { return plugin.getConfig().getString("para-birimi.cogul", "coin"); }
    @Override public String currencyNameSingular() { return plugin.getConfig().getString("para-birimi.tekil", "coin"); }

    @Override public boolean hasAccount(String name) { return true; }
    @Override public boolean hasAccount(OfflinePlayer p) { return true; }
    @Override public boolean hasAccount(String name, String world) { return true; }
    @Override public boolean hasAccount(OfflinePlayer p, String world) { return true; }

    @Override public double getBalance(String name) { return balance(keyOf(name)); }
    @Override public double getBalance(OfflinePlayer p) { return balance(keyOf(p)); }
    @Override public double getBalance(String name, String world) { return getBalance(name); }
    @Override public double getBalance(OfflinePlayer p, String world) { return getBalance(p); }

    @Override public boolean has(String name, double a) { return getBalance(name) >= amount(a); }
    @Override public boolean has(OfflinePlayer p, double a) { return getBalance(p) >= amount(a); }
    @Override public boolean has(String name, String world, double a) { return has(name, a); }
    @Override public boolean has(OfflinePlayer p, String world, double a) { return has(p, a); }

    @Override public EconomyResponse withdrawPlayer(String name, double a) { return withdraw(keyOf(name), a); }
    @Override public EconomyResponse withdrawPlayer(OfflinePlayer p, double a) { return withdraw(keyOf(p), a); }
    @Override public EconomyResponse withdrawPlayer(String name, String world, double a) { return withdrawPlayer(name, a); }
    @Override public EconomyResponse withdrawPlayer(OfflinePlayer p, String world, double a) { return withdrawPlayer(p, a); }

    @Override public EconomyResponse depositPlayer(String name, double a) { return deposit(keyOf(name), a); }
    @Override public EconomyResponse depositPlayer(OfflinePlayer p, double a) { return deposit(keyOf(p), a); }
    @Override public EconomyResponse depositPlayer(String name, String world, double a) { return depositPlayer(name, a); }
    @Override public EconomyResponse depositPlayer(OfflinePlayer p, String world, double a) { return depositPlayer(p, a); }

    @Override public boolean createPlayerAccount(String name) { return true; }
    @Override public boolean createPlayerAccount(OfflinePlayer p) { return true; }
    @Override public boolean createPlayerAccount(String name, String world) { return true; }
    @Override public boolean createPlayerAccount(OfflinePlayer p, String world) { return true; }

    private static EconomyResponse noBank() { return new EconomyResponse(0, 0, ResponseType.NOT_IMPLEMENTED, "Banka desteklenmiyor."); }
    @Override public EconomyResponse createBank(String name, String player) { return noBank(); }
    @Override public EconomyResponse createBank(String name, OfflinePlayer player) { return noBank(); }
    @Override public EconomyResponse deleteBank(String name) { return noBank(); }
    @Override public EconomyResponse bankBalance(String name) { return noBank(); }
    @Override public EconomyResponse bankHas(String name, double a) { return noBank(); }
    @Override public EconomyResponse bankWithdraw(String name, double a) { return noBank(); }
    @Override public EconomyResponse bankDeposit(String name, double a) { return noBank(); }
    @Override public EconomyResponse isBankOwner(String name, String player) { return noBank(); }
    @Override public EconomyResponse isBankOwner(String name, OfflinePlayer player) { return noBank(); }
    @Override public EconomyResponse isBankMember(String name, String player) { return noBank(); }
    @Override public EconomyResponse isBankMember(String name, OfflinePlayer player) { return noBank(); }
    @Override public List<String> getBanks() { return Collections.emptyList(); }
}
