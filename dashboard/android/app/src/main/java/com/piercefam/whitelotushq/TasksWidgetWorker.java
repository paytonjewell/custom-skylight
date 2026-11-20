package com.piercefam.whitelotushq;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Fetches the Tasks widgets' lists. Android cuts a background app off from the network (and Battery
 * Saver does too), but a job keeps it while it runs; an expedited one runs straight away.
 */
public class TasksWidgetWorker extends Worker {

    public TasksWidgetWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    /** Refresh every Tasks widget soon (a refresh already waiting is replaced) */
    static void enqueue(Context ctx) {
        OneTimeWorkRequest.Builder b = new OneTimeWorkRequest.Builder(TasksWidgetWorker.class).setConstraints(
            new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        );
        // Below Android 12 an expedited job would need a foreground notification: a normal one will do
        if (Build.VERSION.SDK_INT >= 31) b.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);
        WorkManager.getInstance(ctx).enqueueUniqueWork("tasks-widget", ExistingWorkPolicy.REPLACE, b.build());
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, TasksWidget.class))) TasksWidget.refresh(ctx, mgr, id);
        return Result.success();
    }
}
