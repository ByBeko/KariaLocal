package live.karia.ekonomi;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import org.bukkit.configuration.file.YamlConfiguration;

/**
 * Hesap defteri.
 * local  : sunucuda tutulan bakiyeler. Anahtar "u:<uuid>" (oyuncu, kasaba, ulus) ya da "n:<ad>" (adla açılan hesaplar).
 *          Bağlı oyuncuda eksi değer, bottan düşülemeyen borçtur.
 * linked : Discord'a bağlı oyuncuların bottaki son bilinen bakiyesi.
 * queue  : bota henüz iletilmemiş işlemler. txId tekildir; aynı işlem tekrar gönderilse de bot bir kez işler.
 */
final class Ledger {
    record Op(String txId, UUID uuid, long amount, String reason) {}

    final Map<String, Long> local = new ConcurrentHashMap<>();
    final Map<UUID, Long> linked = new ConcurrentHashMap<>();
    final Map<String, UUID> names = new ConcurrentHashMap<>();
    final Deque<Op> queue = new ConcurrentLinkedDeque<>();

    static String key(UUID uuid) { return "u:" + uuid; }
    static String key(String name) { return "n:" + name.toLowerCase(java.util.Locale.ROOT); }

    long localOf(String key) { return local.getOrDefault(key, 0L); }
    void addLocal(String key, long delta) { local.merge(key, delta, Long::sum); }

    boolean hasPending(UUID uuid) {
        for (Op op : queue) if (op.uuid().equals(uuid)) return true;
        return false;
    }

    long pendingOf(UUID uuid) {
        long s = 0;
        for (Op op : queue) if (op.uuid().equals(uuid)) s += op.amount();
        return s;
    }

    synchronized void load(File file) {
        if (!file.exists()) return;
        YamlConfiguration y = YamlConfiguration.loadConfiguration(file);
        for (String line : y.getStringList("local")) {
            String[] p = line.split("\t");
            if (p.length == 2) local.put(p[0], Long.parseLong(p[1]));
        }
        for (String line : y.getStringList("linked")) {
            String[] p = line.split("\t");
            if (p.length == 2) linked.put(UUID.fromString(p[0]), Long.parseLong(p[1]));
        }
        for (String line : y.getStringList("names")) {
            String[] p = line.split("\t");
            if (p.length == 2) names.put(p[0], UUID.fromString(p[1]));
        }
        for (String line : y.getStringList("queue")) {
            String[] p = line.split("\t", 4);
            if (p.length == 4) queue.add(new Op(p[0], UUID.fromString(p[1]), Long.parseLong(p[2]), p[3]));
        }
    }

    synchronized void save(File file) throws IOException {
        YamlConfiguration y = new YamlConfiguration();
        List<String> l = new ArrayList<>();
        local.forEach((k, v) -> { if (v != 0) l.add(k + "\t" + v); });
        y.set("local", l);
        List<String> ln = new ArrayList<>();
        linked.forEach((k, v) -> ln.add(k + "\t" + v));
        y.set("linked", ln);
        List<String> n = new ArrayList<>();
        names.forEach((k, v) -> n.add(k + "\t" + v));
        y.set("names", n);
        List<String> q = new ArrayList<>();
        for (Op op : queue) q.add(op.txId() + "\t" + op.uuid() + "\t" + op.amount() + "\t" + op.reason().replace('\t', ' '));
        y.set("queue", q);
        File tmp = new File(file.getParentFile(), file.getName() + ".tmp");
        y.save(tmp);
        if (!tmp.renameTo(file)) {
            java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
