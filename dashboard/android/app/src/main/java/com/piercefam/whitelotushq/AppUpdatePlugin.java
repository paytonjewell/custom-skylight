package com.piercefam.whitelotushq;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The app updating itself (the web side is src/data/appUpdate.ts, the server side worker/app.ts).
 * info() says which build is installed; install() downloads the newest APK from the dashboard, with
 * the WebView's sign-in cookie, and hands it to Android's package installer, which asks to confirm.
 *
 * Events: "progress" { fraction } while downloading; "status" { state: "confirm" | "failed", message }
 * from the installer. When the update succeeds Android replaces the app, so there's no "done".
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String ACTION = "com.piercefam.whitelotushq.INSTALL_STATUS";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                onInstallerStatus(intent);
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) getContext().unregisterReceiver(receiver);
        io.shutdownNow();
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            JSObject r = new JSObject();
            r.put("versionCode", Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode);
            r.put("versionName", p.versionName);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        // Only from the dashboard itself, so a page can't get the app to install something else
        String home = Uri.parse(getBridge().getConfig().getServerUrl()).getHost();
        Uri u = Uri.parse(url);
        if (!"https".equals(u.getScheme()) || home == null || !home.equals(u.getHost())) {
            call.reject("Updates only come from the dashboard");
            return;
        }
        io.execute(() -> download(call, url));
    }

    private void download(PluginCall call, String url) {
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        int sessionId = -1;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            // The APK is behind the PIN: send the WebView's device cookie (worker/auth.ts)
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("The download failed (HTTP " + code + ")");
            long total = conn.getContentLengthLong();

            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            );
            params.setAppPackageName(getContext().getPackageName());
            if (total > 0) params.setSize(total);
            // Once this app installed itself, Android lets later updates go through without asking
            // (UPDATE_PACKAGES_WITHOUT_USER_ACTION); until then the installer asks to confirm.
            if (Build.VERSION.SDK_INT >= 31) {
                params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            }
            sessionId = installer.createSession(params);

            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (InputStream in = conn.getInputStream(); OutputStream out = session.openWrite("app.apk", 0, total)) {
                    byte[] buf = new byte[64 * 1024];
                    long got = 0;
                    int n, shown = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : -1;
                        if (pct != shown) {
                            shown = pct;
                            JSObject p = new JSObject();
                            p.put("fraction", total > 0 ? (double) got / total : 0);
                            notifyListeners("progress", p);
                        }
                    }
                    session.fsync(out);
                }
                Intent status = new Intent(ACTION).setPackage(getContext().getPackageName());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pending = PendingIntent.getBroadcast(getContext(), sessionId, status, flags);
                session.commit(pending.getIntentSender());
            }
            call.resolve();
        } catch (Exception e) {
            if (sessionId != -1) {
                try {
                    installer.abandonSession(sessionId);
                } catch (Exception ignored) {
                    // already gone
                }
            }
            call.reject(e.getMessage() != null ? e.getMessage() : "The update failed");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void onInstallerStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        JSObject r = new JSObject();
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android's "Update this app?" screen
            Intent confirm = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(confirm);
            r.put("state", "confirm");
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            return; // the app is being replaced
        } else {
            r.put("state", "failed");
            r.put("message", status == PackageInstaller.STATUS_FAILURE_ABORTED
                ? "Update cancelled"
                : intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        }
        notifyListeners("status", r);
    }
}
