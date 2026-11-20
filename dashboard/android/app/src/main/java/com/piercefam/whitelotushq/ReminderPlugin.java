package com.piercefam.whitelotushq;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * The web app's side of reminders in the phone app (src/data/push.ts): asking to show notifications,
 * the FCM token the server sends to, and which screen a tapped reminder opens.
 *
 * Event: "open" { view } when a reminder is tapped while the app is running. On a cold start the web
 * app asks with takeLaunchView() instead, since it isn't listening yet.
 */
@CapacitorPlugin(
    name = "Reminders",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public class ReminderPlugin extends Plugin {

    private String launchView;

    @Override
    public void load() {
        Reminders.ensureChannel(getContext());
        launchView = viewFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String view = viewFrom(intent);
        if (view == null) return;
        JSObject r = new JSObject();
        r.put("view", view);
        notifyListeners("open", r);
    }

    private static String viewFrom(Intent intent) {
        if (intent == null) return null;
        String view = intent.getStringExtra(Reminders.EXTRA_OPEN);
        intent.removeExtra(Reminders.EXTRA_OPEN);
        return view;
    }

    @PluginMethod
    public void takeLaunchView(PluginCall call) {
        JSObject r = new JSObject();
        r.put("view", launchView);
        launchView = null;
        call.resolve(r);
    }

    /** { granted }: asks first on Android 13+, where showing notifications needs permission */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionAnswered");
            return;
        }
        resolveGranted(call);
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        resolveGranted(call);
    }

    private void resolveGranted(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(r);
    }

    /** { token }: where the server sends this phone's reminders */
    @PluginMethod
    public void token(PluginCall call) {
        try {
            FirebaseMessaging.getInstance()
                .getToken()
                .addOnCompleteListener(t -> {
                    if (t.isSuccessful() && t.getResult() != null) {
                        JSObject r = new JSObject();
                        r.put("token", t.getResult());
                        call.resolve(r);
                    } else {
                        call.reject("Couldn’t reach Firebase for reminders. Check the connection and try again.");
                    }
                });
        } catch (IllegalStateException e) {
            // Built without google-services.json
            call.reject("This build of the app can’t get reminders.");
        }
    }
}
