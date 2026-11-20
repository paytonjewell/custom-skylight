package com.piercefam.whitelotushq;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The web app tells the home screen widgets its tasks changed (src/app/widgets.ts) */
@CapacitorPlugin(name = "Widgets")
public class WidgetPlugin extends Plugin {

    @PluginMethod
    public void refresh(PluginCall call) {
        TasksWidget.refreshAll(getContext());
        call.resolve();
    }
}
