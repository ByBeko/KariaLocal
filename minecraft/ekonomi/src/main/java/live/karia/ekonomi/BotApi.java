package live.karia.ekonomi;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** karia.live /api/mc köprüsü. Bütün çağrılar engelleyicidir; yalnızca asenkron iş parçacığından çağır. */
final class BotApi {
    /** status 0 = ağ hatası. */
    record Result(int status, String body) {
        boolean ok() { return status == 200; }
        /** Kalıcı hata: tekrar denemenin anlamı yok (400 geçersiz istek / yetersiz bakiye / bağlı değil). */
        boolean rejected() { return status == 400 || status == 404; }
        String str(String key) {
            Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(body);
            return m.find() ? m.group(1).replace("\\\"", "\"").replace("\\\\", "\\") : null;
        }
        Long num(String key) {
            Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(-?\\d+)").matcher(body);
            return m.find() ? Long.parseLong(m.group(1)) : null;
        }
        boolean bool(String key) {
            Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(true|false)").matcher(body);
            return m.find() && m.group(1).equals("true");
        }
    }

    private final String base;
    private final String secret;
    private final Duration timeout;
    private final HttpClient http;

    BotApi(String base, String secret, int timeoutSeconds) {
        this.base = base.replaceAll("/+$", "");
        this.secret = secret;
        this.timeout = Duration.ofSeconds(Math.max(1, timeoutSeconds));
        this.http = HttpClient.newBuilder().connectTimeout(this.timeout).build();
    }

    boolean configured() { return !base.isEmpty() && !secret.isEmpty(); }

    Result player(UUID uuid) {
        return send("GET", "/player?uuid=" + URLEncoder.encode(uuid.toString(), StandardCharsets.UTF_8), null);
    }

    Result linkCode(UUID uuid, String name) {
        return send("POST", "/link-code", "{\"uuid\":" + q(uuid.toString()) + ",\"name\":" + q(name) + "}");
    }

    Result balance(UUID uuid, long amount, String txId, String reason) {
        return send("POST", "/balance", "{\"uuid\":" + q(uuid.toString()) + ",\"amount\":" + amount
                + ",\"txId\":" + q(txId) + ",\"reason\":" + q(reason) + "}");
    }

    private Result send(String method, String path, String json) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
                    .timeout(timeout)
                    .header("X-Api-Secret", secret)
                    .header("Accept", "application/json")
                    .header("User-Agent", "KariaEkonomi/1.0");
            if (json != null) b.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(json));
            else b.method(method, HttpRequest.BodyPublishers.noBody());
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(r.statusCode(), r.body() == null ? "" : r.body());
        } catch (Exception e) {
            return new Result(0, "");
        }
    }

    private static String q(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> { if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c); }
            }
        }
        return sb.append('"').toString();
    }
}
