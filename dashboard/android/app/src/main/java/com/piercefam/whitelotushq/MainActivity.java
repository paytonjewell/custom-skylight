package com.piercefam.whitelotushq;

import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onPause() {
        super.onPause();
        // The WebView writes cookies to disk only now and then. Write them now, so the PIN sign-in
        // (the hq_device cookie) isn't lost if Android closes the app soon after signing in.
        CookieManager.getInstance().flush();
    }
}
