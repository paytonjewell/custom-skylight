import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { cloudflare } from '@cloudflare/vite-plugin';

// Build targets stay conservative so the bundle also runs on older Android WebViews (the BIUFRAME
// this started on runs WebView 106). The Skylight Calendar 2 runs WebView 124
// (docs/skylight-calendar-2.md), so 106 is still the floor while the BIUFRAME is in use.
// CSS targets chrome61 on purpose: older WebViews reject 4/8-digit hex colours (#0000, #ffffffbf),
// and a newer target lets the minifier rewrite transparent/rgba() into that form.
// The Cloudflare plugin runs the Worker (worker/index.ts: PIN gate + photo API) in the dev server,
// with local D1 and R2 kept in .wrangler/state. `vite build` outputs the app and the Worker together.
//
// CSS goes through Lightning CSS with the same chrome61 target, in dev and build. That lets component
// styles (*.module.css next to each component) use nesting, which it flattens into plain selectors,
// since WebView 106 has no native CSS nesting. Global CSS (css/) passes through the same way.
// One rule when nesting: put `.phone &` / `[data-theme] &` only inside a single-class parent
// (`.row { .phone & {} }`). Inside a parent with a combinator (`.row b`), Lightning CSS writes
// `.phone :is(.row b)`, which older WebViews drop. Write those as a flat rule right after the parent:
// `.row b {}` then `:global(.phone) .row b {}`.
const CSS_TARGETS = { chrome: 61 << 16 }; // Lightning CSS encodes versions as major << 16

// React Compiler memoizes components and hooks, so a store change only redraws what it affects (the
// frame's MT8786 is slow). A component it can't compile still works, just unmemoized: those are listed
// in the dev server and build output so they can be fixed.
const compilerLogger = {
  logEvent(file: string | null, e: { kind: string; fnLoc?: { start: { line: number } } | null; detail?: unknown }) {
    if (e.kind !== 'CompileError' && e.kind !== 'PipelineError') return;
    const d = e.detail as { reason?: string; options?: { reason?: string } } | undefined;
    const where = `${file?.slice(file.indexOf('/src/') + 1)}:${e.fnLoc?.start.line ?? '?'}`;
    console.warn(`[react-compiler] skipped ${where}: ${d?.reason ?? d?.options?.reason ?? e.kind}`);
  },
};

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset({ logger: compilerLogger })] }), cloudflare()],
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: CSS_TARGETS,
      // Class names in a module become File_class_hash, so they can't collide with anything else.
      // Grid area names (grid-template-areas / grid-area) stay as written. Keyframes are still scoped,
      // so each module defines the animations it uses.
      cssModules: { pattern: '[name]_[local]_[hash]', grid: false },
    },
  },
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
    cssMinify: 'lightningcss',
  },
  server: { host: true },
});
