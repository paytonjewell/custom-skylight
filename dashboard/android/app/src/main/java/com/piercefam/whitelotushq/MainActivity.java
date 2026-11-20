package com.piercefam.whitelotushq;

import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, registered before the bridge starts
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(ReminderPlugin.class);
        registerPlugin(SharePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // The WebView writes cookies to disk only now and then. Write them now, so the PIN sign-in
        // (the hq_device cookie) isn't lost if Android closes the app soon after signing in.
        CookieManager.getInstance().flush();
    }
}
