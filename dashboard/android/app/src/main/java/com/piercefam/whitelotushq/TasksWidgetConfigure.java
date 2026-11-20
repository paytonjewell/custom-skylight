package com.piercefam.whitelotushq;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Setting up a Tasks widget (TasksWidget.java), when it's added, and again from "reconfigure" when
 * it's held: whose tasks it shows, and how solid its background is (with a preview over a stand-in
 * wallpaper). People come from the dashboard (GET /api/family), like everywhere else.
 */
public class TasksWidgetConfigure extends AppCompatActivity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private String picked;
    private LinearLayout peopleBox;
    private TextView status;
    private Button save;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // Backing out leaves no half-set-up widget
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setContentView(R.layout.activity_widget_setup);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(!night);

        SharedPreferences prefs = TasksWidget.prefs(this);
        picked = prefs.getString("person_" + widgetId, null);
        boolean editing = picked != null;
        peopleBox = findViewById(R.id.setup_people);
        status = findViewById(R.id.setup_status);
        save = findViewById(R.id.setup_save);
        save.setText(editing ? "Save" : "Add widget");
        save.setOnClickListener(v -> finishSetup());

        SeekBar opacity = findViewById(R.id.setup_opacity);
        ImageView previewBg = findViewById(R.id.setup_preview_bg);
        TextView opacityLabel = findViewById(R.id.setup_opacity_label);
        opacity.setOnSeekBarChangeListener(
            new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar s, int value, boolean fromUser) {
                    previewBg.setImageAlpha(Math.round(value * 2.55f));
                    opacityLabel.setText(value == 100 ? "Solid" : value == 0 ? "No background" : value + "%");
                }

                @Override
                public void onStartTrackingTouch(SeekBar s) {}

                @Override
                public void onStopTrackingTouch(SeekBar s) {}
            }
        );
        opacity.setProgress(prefs.getInt("opacity_" + widgetId, 100));
        // setProgress doesn't call the listener when the value is already the default
        previewBg.setImageAlpha(Math.round(opacity.getProgress() * 2.55f));
        opacityLabel.setText(opacity.getProgress() == 100 ? "Solid" : opacity.getProgress() + "%");

        loadPeople();
    }

    private void loadPeople() {
        new Thread(() -> {
            try {
                JSONArray family = new JSONArray(Dashboard.get(this, "/api/family"));
                runOnUiThread(() -> showPeople(family));
            } catch (Exception e) {
                String why = "signed out".equals(e.getMessage())
                    ? "Open White Lotus HQ and sign in first, then add the widget again."
                    : "Can’t reach the dashboard. Check the connection and try again.";
                runOnUiThread(() -> status.setText(why));
            }
        }).start();
    }

    /** Everyone with tasks, then Anyone (as the Tasks screen's columns) */
    private void showPeople(JSONArray family) {
        status.setVisibility(View.GONE);
        peopleBox.removeAllViews();
        for (int i = 0; i < family.length(); i++) {
            JSONObject p = family.optJSONObject(i);
            if (p == null || !p.optBoolean("tasks", true)) continue;
            addPerson(p.optString("id"), p.optString("name"), p.optInt("tone", 0));
        }
        addPerson("any", "Anyone", 0);
        refreshPicked();
    }

    private void addPerson(String id, String name, int tone) {
        View row = LayoutInflater.from(this).inflate(R.layout.widget_setup_person, peopleBox, false);
        row.setTag(id);
        TextView avatar = row.findViewById(R.id.person_avatar);
        avatar.setText(name.isEmpty() ? "" : name.substring(0, 1).toUpperCase(Locale.ROOT));
        avatar.setTextColor(TasksWidget.toneInk(this, tone));
        GradientDrawable circle = (GradientDrawable) avatar.getBackground().mutate();
        circle.setColor(TasksWidget.tone(this, tone));
        ((TextView) row.findViewById(R.id.person_name)).setText(name);
        row.setOnClickListener(v -> {
            picked = id;
            refreshPicked();
        });
        peopleBox.addView(row);
    }

    private void refreshPicked() {
        boolean any = false;
        for (int i = 0; i < peopleBox.getChildCount(); i++) {
            View row = peopleBox.getChildAt(i);
            boolean on = row.getTag().equals(picked);
            any |= on;
            row.setBackgroundResource(on ? R.drawable.widget_card_selected : R.drawable.widget_card);
            row.findViewById(R.id.person_check).setVisibility(on ? View.VISIBLE : View.INVISIBLE);
        }
        save.setEnabled(any);
    }

    private void finishSetup() {
        int opacity = ((SeekBar) findViewById(R.id.setup_opacity)).getProgress();
        TasksWidget.prefs(this)
            .edit()
            .putString("person_" + widgetId, picked)
            .putInt("opacity_" + widgetId, opacity)
            .remove("cache_" + widgetId)
            .commit();
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        new Thread(() -> TasksWidget.refresh(getApplicationContext(), mgr, widgetId)).start();
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }
}
