package com.piercefam.whitelotushq;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Share → White Lotus HQ" from another app (the web side is src/app/share.ts): photos from Google
 * Photos, or a link from the browser. Shared files are only readable while the share lasts, so they're
 * copied into the app's cache first; the web app then reads each with read() and adds it, as it does
 * photos from the Add button, and calls clear().
 *
 * Event: "shared" { text, files: [{ index, name, type, size }] }, kept until the web app listens, so a
 * share that starts the app isn't lost.
 */
@CapacitorPlugin(name = "Share")
public class SharePlugin extends Plugin {

    private static final int MAX_FILES = 100;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        receive(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        receive(intent);
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
    }

    private File inbox() {
        return new File(getContext().getCacheDir(), "share-inbox");
    }

    private void receive(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        // Handled once: a screen rotation re-delivers the same intent
        intent.setAction(Intent.ACTION_MAIN);

        String text = join(intent.getStringExtra(Intent.EXTRA_TEXT), intent.getStringExtra(Intent.EXTRA_SUBJECT));
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri one = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> many = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        io.execute(() -> copyAndAnnounce(text, uris));
    }

    private void copyAndAnnounce(String text, ArrayList<Uri> uris) {
        File dir = inbox();
        deleteAll(dir);
        dir.mkdirs();
        ContentResolver cr = getContext().getContentResolver();
        JSArray files = new JSArray();
        for (int i = 0; i < uris.size() && i < MAX_FILES; i++) {
            Uri uri = uris.get(i);
            String type = cr.getType(uri);
            if (type == null || !type.startsWith("image/")) continue;
            File out = new File(dir, String.valueOf(i));
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) continue;
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            } catch (Exception e) {
                continue;
            }
            JSObject f = new JSObject();
            f.put("index", i);
            f.put("name", displayName(cr, uri, "photo-" + i));
            f.put("type", type);
            f.put("size", out.length());
            files.put(f);
        }
        if (files.length() == 0 && text == null) return;
        JSObject shared = new JSObject();
        shared.put("text", text);
        shared.put("files", files);
        notifyListeners("shared", shared, true);
    }

    /** { data }: a shared file, base64 */
    @PluginMethod
    public void read(PluginCall call) {
        Integer index = call.getInt("index");
        File f = new File(inbox(), String.valueOf(index));
        if (index == null || !f.isFile()) {
            call.reject("That shared file is gone");
            return;
        }
        io.execute(() -> {
            try (InputStream in = new FileInputStream(f)) {
                byte[] bytes = new byte[(int) f.length()];
                int off = 0, n;
                while (off < bytes.length && (n = in.read(bytes, off, bytes.length - off)) > 0) off += n;
                JSObject r = new JSObject();
                r.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn’t read the shared file");
            }
        });
    }

    /** Forget the shared files, once they're added */
    @PluginMethod
    public void clear(PluginCall call) {
        io.execute(() -> {
            deleteAll(inbox());
            call.resolve();
        });
    }

    private static String displayName(ContentResolver cr, Uri uri, String fallback) {
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {
            // some apps' providers don't answer: use the fallback
        }
        return fallback;
    }

    private static String join(String a, String b) {
        if (a == null || a.isEmpty()) return b == null || b.isEmpty() ? null : b;
        return b == null || b.isEmpty() ? a : a + "\n" + b;
    }

    private static void deleteAll(File dir) {
        File[] kids = dir.listFiles();
        if (kids != null) for (File k : kids) k.delete();
    }
}
