package com.piercefam.whitelotushq;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.CapConfig;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * "Done" on a reminder: ticks the task on the dashboard without opening the app, as the browser's
 * service worker does (public/sw.js). Signed in with the WebView's device cookie.
 */
public class ReminderDoneReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String tag = intent.getStringExtra("tag");
        String task = intent.getStringExtra("task");
        String day = intent.getStringExtra("day");
        String by = intent.getStringExtra("by");
        if (tag == null || task == null || day == null) return;
        Context ctx = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (markDone(ctx, task, day, by)) {
                    NotificationManagerCompat.from(ctx).cancel(tag, 0);
                    TasksWidget.refreshAll(ctx);
                } else {
                    Reminders.showNote(ctx, tag, "Couldn’t mark it done", "Tap to open Tasks and tick it there.");
                }
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static boolean markDone(Context ctx, String task, String day, String by) {
        HttpURLConnection conn = null;
        try {
            String origin = CapConfig.loadDefault(ctx).getServerUrl();
            String url = origin.replaceAll("/+$", "") + "/api/tasks/" + Uri.encode(task) + "/done/" + Uri.encode(day);
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            JSONObject body = new JSONObject().put("at", iso.format(new Date())).put("by", by == null ? JSONObject.NULL : by);

            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("PUT");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
