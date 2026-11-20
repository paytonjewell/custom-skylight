package com.piercefam.whitelotushq;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Receives reminders from Firebase, even when the app is closed. A new token needs no handling here:
 * the web app checks the token each time it starts and saves a changed one (src/data/push.ts).
 */
public class ReminderMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if (!message.getData().isEmpty()) Reminders.show(this, message.getData());
    }
}
