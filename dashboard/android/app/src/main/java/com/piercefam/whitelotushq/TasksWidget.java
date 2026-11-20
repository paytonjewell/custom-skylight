package com.piercefam.whitelotushq;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import androidx.core.widget.RemoteViewsCompat;
import java.text.SimpleDateFormat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Tasks home screen widget: one person's tasks for today, drawn like the Tasks screen (cards,
 * the person's colour behind each emoji, Inter and Fraunces, the Pastel or Dark theme with the
 * phone's light or dark mode). The server works out the list (worker/widget.ts, GET
 * /api/widget/tasks); this only draws it. Set up in TasksWidgetConfigure: whose tasks, and how solid
 * the background is.
 *
 * Refreshed every 30 minutes (tasks_widget_info.xml), when the app's tasks change (WidgetPlugin), and
 * after "Done" on a reminder. The last list is kept, so the widget still shows it when offline.
 */
public class TasksWidget extends AppWidgetProvider {

    static final String PREFS = "tasks_widget";

    /** Person colours, light and dark (--t0…--t4, --tN-ink in css/tokens.css); 0 is Family / Anyone */
    private static final int[][] TONE = {
        { 0xFFF5BE8C, 0xFFB98251 },
        { 0xFFB9A6E8, 0xFF7E6BB0 },
        { 0xFFEFA9C3, 0xFFB06D88 },
        { 0xFF9EC5EC, 0xFF5F89B5 },
        { 0xFFA8D8B5, 0xFF5E9873 },
    };
    private static final int[][] TONE_INK = {
        { 0xFF4D2F12, 0xFFFFF4EA },
        { 0xFF2E2547, 0xFFF3F0FA },
        { 0xFF4A2333, 0xFFFCEFF4 },
        { 0xFF1F3550, 0xFFEEF4FB },
        { 0xFF1E4029, 0xFFEEF7F1 },
    };
    /** --tint: how strong person-coloured backgrounds are, light and dark */
    private static final float[] TINT = { 0.3f, 0.24f };

    /** Draw the last lists at once, then fetch new ones in a job (TasksWidgetWorker) */
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) showSaved(ctx, mgr, id);
        TasksWidgetWorker.enqueue(ctx);
    }

    /** Resized: redraw at once from the last list (the host keeps the old drawing until then), then refresh */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, android.os.Bundle options) {
        onUpdate(ctx, mgr, new int[] { id });
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        for (int id : ids) e.remove("person_" + id).remove("opacity_" + id).remove("cache_" + id);
        e.apply();
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Refresh every Tasks widget (in a job, which has network access even in the background) */
    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        if (mgr.getAppWidgetIds(new ComponentName(ctx, TasksWidget.class)).length > 0) TasksWidgetWorker.enqueue(ctx);
    }

    /** The last list (or what's missing), without fetching */
    private static void showSaved(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences p = prefs(ctx);
        String cached = p.getString("cache_" + id, null);
        if (p.getString("person_" + id, null) == null) mgr.updateAppWidget(id, message(ctx, id, "Tap to choose whose tasks"));
        else if (cached != null) show(ctx, mgr, id, cached);
    }

    /** Fetch one widget's list and draw it. Off the main thread, with network access (a job, or the app open). */
    static void refresh(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences p = prefs(ctx);
        String person = p.getString("person_" + id, null);
        if (person == null) {
            mgr.updateAppWidget(id, message(ctx, id, "Tap to choose whose tasks"));
            return;
        }
        // The last list first, so the widget never sits blank or stale-looking while the fetch runs
        String cached = p.getString("cache_" + id, null);
        if (cached != null) show(ctx, mgr, id, cached);
        String json;
        try {
            json = Dashboard.get(ctx, "/api/widget/tasks?person=" + Uri.encode(person));
        } catch (Exception e) {
            Log.w("TasksWidget", "Fetch failed for widget " + id + ": " + e);
            // Offline or signed out: the last list stays up; with none, say why
            if (cached == null) {
                mgr.updateAppWidget(
                    id,
                    message(ctx, id, "signed out".equals(e.getMessage()) ? "Open White Lotus HQ to sign in" : "Can’t reach the dashboard")
                );
            }
            return;
        }
        // commit, not apply: Samsung freezes and kills background apps quickly, and apply's write to
        // disk could be lost with them (this runs off the main thread, so waiting is fine)
        p.edit().putString("cache_" + id, json).commit();
        show(ctx, mgr, id, json);
    }

    private static void show(Context ctx, AppWidgetManager mgr, int id, String json) {
        try {
            mgr.updateAppWidget(id, draw(ctx, id, new JSONObject(json), prefs(ctx).getInt("opacity_" + id, 100)));
        } catch (Exception e) {
            Log.w("TasksWidget", "Drawing failed for widget " + id, e);
            mgr.updateAppWidget(id, message(ctx, id, "Couldn’t show the tasks"));
        }
    }

    private static RemoteViews draw(Context ctx, int id, JSONObject w, int opacity) throws Exception {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_tasks);
        background(rv, opacity);

        JSONObject person = w.getJSONObject("person");
        int tone = Math.max(0, Math.min(4, person.optInt("tone", 0)));
        String name = person.optString("name", "");
        int done = w.optInt("done"), total = w.optInt("total");
        rv.setTextViewText(R.id.widget_name, name);
        rv.setTextViewText(R.id.widget_avatar, name.isEmpty() ? "" : name.substring(0, 1).toUpperCase(Locale.ROOT));
        color(ctx, rv, R.id.widget_avatar_bg, "setColorFilter", TONE[tone]);
        color(ctx, rv, R.id.widget_avatar, "setTextColor", TONE_INK[tone]);
        rv.setTextViewText(R.id.widget_sub, dayName(w.optString("day")));
        rv.setTextViewText(R.id.widget_count, total == 0 ? "" : done + "/" + total);
        rv.setOnClickPendingIntent(R.id.widget_header, openTasks(ctx, id));

        JSONArray groups = w.getJSONArray("groups");
        RemoteViewsCompat.RemoteCollectionItems.Builder items = new RemoteViewsCompat.RemoteCollectionItems.Builder()
            .setHasStableIds(true)
            .setViewTypeCount(3);
        long row = 0;
        for (int g = 0; g < groups.length(); g++) {
            JSONObject group = groups.getJSONObject(g);
            String label = group.getString("label");
            boolean habits = "Habits".equals(label);
            RemoteViews head = new RemoteViews(ctx.getPackageName(), R.layout.widget_group);
            head.setTextViewText(R.id.group_label, label);
            items.addItem(row++, head);
            JSONArray list = group.getJSONArray("items");
            for (int i = 0; i < list.length(); i++) items.addItem(row++, task(ctx, list.getJSONObject(i), tone, habits));
        }
        if (total > 0 && done == total) items.addItem(row++, new RemoteViews(ctx.getPackageName(), R.layout.widget_all_done));

        boolean empty = total == 0;
        rv.setViewVisibility(R.id.widget_list, empty ? View.GONE : View.VISIBLE);
        rv.setViewVisibility(R.id.widget_empty, empty ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.widget_empty, "Nothing to do today");
        RemoteViewsCompat.setRemoteAdapter(ctx, rv, id, R.id.widget_list, items.build());
        rv.setPendingIntentTemplate(R.id.widget_list, openTemplate(ctx, id));
        return rv;
    }

    /** One task row: a card with the emoji in the person's colour (a tick once done) */
    private static RemoteViews task(Context ctx, JSONObject t, int tone, boolean habit) {
        RemoteViews r = new RemoteViews(ctx.getPackageName(), R.layout.widget_task);
        boolean done = t.optBoolean("done");
        String emoji = t.optString("emoji", "");
        String title = t.optString("title", "");
        String note = t.optString("note", "");

        if (done) {
            SpannableString s = new SpannableString(title);
            s.setSpan(new StrikethroughSpan(), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            r.setTextViewText(R.id.task_title, s);
            r.setTextColor(R.id.task_title, ContextCompat.getColor(ctx, R.color.hq_mute));
        } else {
            r.setTextViewText(R.id.task_title, title);
        }
        r.setTextViewText(R.id.task_note, note);
        r.setViewVisibility(R.id.task_note, note.isEmpty() ? View.GONE : View.VISIBLE);
        if (t.optBoolean("overdue")) r.setTextColor(R.id.task_note, ContextCompat.getColor(ctx, R.color.hq_alert));

        if (emoji.isEmpty()) {
            // No emoji: no box, just the text, and a tick at the end once done (as on the Tasks screen)
            r.setViewVisibility(R.id.task_mark, View.GONE);
            r.setViewPadding(R.id.task_card, px(ctx, 16), px(ctx, 8), px(ctx, 12), px(ctx, 8));
            r.setViewVisibility(R.id.task_tick, done && !habit ? View.VISIBLE : View.GONE);
            color(ctx, r, R.id.task_tick, "setColorFilter", TONE[tone]);
        } else {
            if (habit) r.setImageViewResource(R.id.task_mark_bg, R.drawable.widget_mark_round);
            r.setTextViewText(R.id.task_emoji, emoji);
            r.setViewVisibility(R.id.task_emoji, done ? View.GONE : View.VISIBLE);
            r.setViewVisibility(R.id.task_check, done ? View.VISIBLE : View.GONE);
            color(ctx, r, R.id.task_mark_bg, "setColorFilter", done ? TONE[tone] : tint(TONE[tone]));
            color(ctx, r, R.id.task_check, "setColorFilter", TONE_INK[tone]);
        }
        if (habit) {
            r.setTextViewText(R.id.task_count, done ? "1/1" : "0/1");
            r.setViewVisibility(R.id.task_count, View.VISIBLE);
        }
        r.setOnClickFillInIntent(R.id.task_card, new Intent());
        return r;
    }

    /** A widget that can't show tasks yet: the panel with a line of text; tapping sets it up */
    private static RemoteViews message(Context ctx, int id, String text) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_tasks);
        background(rv, prefs(ctx).getInt("opacity_" + id, 100));
        rv.setViewVisibility(R.id.widget_header, View.GONE);
        rv.setViewVisibility(R.id.widget_list, View.GONE);
        rv.setViewVisibility(R.id.widget_empty, View.VISIBLE);
        rv.setTextViewText(R.id.widget_empty, text);
        Intent setup = new Intent(ctx, TasksWidgetConfigure.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
            .setData(Uri.parse("hq-widget://setup/" + id));
        rv.setOnClickPendingIntent(
            android.R.id.background,
            PendingIntent.getActivity(ctx, id, setup, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
        );
        return rv;
    }

    /** The panel's opacity: 100 solid, down to 0 (just the cards on the wallpaper) */
    private static void background(RemoteViews rv, int opacity) {
        rv.setInt(R.id.widget_bg, "setImageAlpha", Math.round(Math.max(0, Math.min(100, opacity)) * 2.55f));
    }

    /**
     * A colour that follows the phone's light/dark mode. Android 12+ switches it by itself; older
     * versions get the one for the mode it's in now (fixed at the next refresh).
     */
    private static void color(Context ctx, RemoteViews rv, int view, String method, int[] lightDark) {
        if (Build.VERSION.SDK_INT >= 31) rv.setColorInt(view, method, lightDark[0], lightDark[1]);
        else rv.setInt(view, method, night(ctx) ? lightDark[1] : lightDark[0]);
    }

    /** The person's colour at --tint strength, light and dark */
    private static int[] tint(int[] c) {
        return new int[] { withAlpha(c[0], TINT[0]), withAlpha(c[1], TINT[1]) };
    }

    private static int withAlpha(int c, float a) {
        return (Math.round(a * 255) << 24) | (c & 0x00FFFFFF);
    }

    /** A person's colour, and the text colour on it, for the phone's current light/dark mode */
    static int tone(Context ctx, int tone) {
        return TONE[Math.max(0, Math.min(4, tone))][night(ctx) ? 1 : 0];
    }

    static int toneInk(Context ctx, int tone) {
        return TONE_INK[Math.max(0, Math.min(4, tone))][night(ctx) ? 1 : 0];
    }

    private static boolean night(Context ctx) {
        return (ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private static int px(Context ctx, int dp) {
        return Math.round(dp * ctx.getResources().getDisplayMetrics().density);
    }

    /** "Friday" for today's date */
    private static String dayName(String day) {
        try {
            return new SimpleDateFormat("EEEE", Locale.getDefault()).format(new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(day));
        } catch (Exception e) {
            return "Today";
        }
    }

    private static Intent tasksIntent(Context ctx, int id) {
        return new Intent(ctx, MainActivity.class)
            .putExtra(Reminders.EXTRA_OPEN, "tasks")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private static PendingIntent openTasks(Context ctx, int id) {
        return PendingIntent.getActivity(ctx, id, tasksIntent(ctx, id), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** For the rows: each fills in nothing, so a tap opens Tasks like the header */
    private static PendingIntent openTemplate(Context ctx, int id) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getActivity(ctx, 100000 + id, tasksIntent(ctx, id), flags);
    }
}
