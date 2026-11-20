package com.piercefam.whitelotushq;

import android.content.Context;
import android.webkit.CookieManager;
import com.getcapacitor.CapConfig;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Requests to the dashboard from native code (the widget, its setup screen, "Done" on a reminder),
 * signed in with the WebView's device cookie, as the web app is. Call off the main thread.
 */
final class Dashboard {

    private Dashboard() {}

    /** The dashboard's address (server.url in capacitor.config.json), without a trailing slash */
    static String origin(Context ctx) {
        return CapConfig.loadDefault(ctx).getServerUrl().replaceAll("/+$", "");
    }

    /** GET a path ("/api/family"); the body, or an IOException saying why not */
    static String get(Context ctx, String path) throws IOException {
        return send(ctx, "GET", path, null);
    }

    /** Send JSON; the body, or an IOException */
    static String send(Context ctx, String method, String path, String json) throws IOException {
        String url = origin(ctx) + path;
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            if (json != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = conn.getResponseCode();
            if (code == 401) throw new IOException("signed out");
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[16 * 1024];
                int n;
                while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                return buf.toString("UTF-8");
            }
        } finally {
            conn.disconnect();
        }
    }
}
