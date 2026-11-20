package com.piercefam.whitelotushq;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Map;

/**
 * Drawing task reminders. The server sends them as data-only FCM messages (worker/fcm.ts), so the app
 * draws every one itself, on a channel of its own: high importance, so Android shows a banner, plays
 * the sound and vibrates. Tapping opens Tasks; "Done" ticks the task (ReminderDoneReceiver).
 */
final class Reminders {

    static final String CHANNEL = "reminders";
    /** Extra on the activity intent: which screen to open (ReminderPlugin passes it to the web app) */
    static final String EXTRA_OPEN = "open";

    private Reminders() {}

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Task reminders", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Reminders for tasks, at the time set on each task");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 200, 100, 200 });
        nm.createNotificationChannel(ch);
    }

    /** The data the server sends: title, body, tag, and task, day and by when it's a task's reminder */
    static void show(Context ctx, Map<String, String> data) {
        ensureChannel(ctx);
        String tag = orDefault(data.get("tag"), "reminder");
        String task = data.get("task");
        String day = data.get("day");

        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra(EXTRA_OPEN, "tasks")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setColor(0xFF3F7F57)
            .setContentTitle(orDefault(data.get("title"), "Reminder"))
            .setContentText(data.get("body"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(
                PendingIntent.getActivity(ctx, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
            );

        if (task != null && day != null) {
            Intent done = new Intent(ctx, ReminderDoneReceiver.class)
                .putExtra("tag", tag)
                .putExtra("task", task)
                .putExtra("day", day)
                .putExtra("by", data.get("by"));
            b.addAction(
                0,
                "Done",
                PendingIntent.getBroadcast(ctx, tag.hashCode(), done, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
            );
        }
        notify(ctx, tag, b);
    }

    /** Replace a reminder with a note (when "Done" couldn't be saved) */
    static void showNote(Context ctx, String tag, String title, String text) {
        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra(EXTRA_OPEN, "tasks")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setColor(0xFF3F7F57)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(
                PendingIntent.getActivity(ctx, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
            );
        notify(ctx, tag, b);
    }

    private static void notify(Context ctx, String tag, NotificationCompat.Builder b) {
        try {
            NotificationManagerCompat.from(ctx).notify(tag, 0, b.build());
        } catch (SecurityException e) {
            // Notifications not allowed: nothing to show
        }
    }

    private static String orDefault(String s, String fallback) {
        return s == null || s.isEmpty() ? fallback : s;
    }
}
