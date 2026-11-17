// App shell. On the frame: the 1280×800 stage, sidebar rail, screens and overlays, plus idle → photo
// frame (or a black sleep screen during the sleep hours). On a phone (src/app/layout.ts): full-screen scrolling screens and a bottom tab bar.
import { Kitchen } from '../views/recipes/Kitchen';
import { checkSharedRecipe } from '../views/recipes/AddRecipeSheet';
import { startKitchenSync } from '../data/kitchenSync';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type RefObject } from 'react';
import { fmt } from '../lib/fmt';
import { now as clockNow, useNow } from '../lib/clock';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { Home } from '../views/Home';
import { Calendar } from '../views/calendar/Calendar';
import { Tasks } from '../views/tasks/Tasks';
import { Lists } from '../views/lists/Lists';
import { News } from '../views/News';
import { Photos, receiveSharedPhotos } from '../views/Photos';
import { Ambient, SheetHost, Sleep, Toasts } from './Overlays';
import { isSleepTime, setBacklight } from './sleep';
import { Diag, diagEnabled } from './Diag';
import { startPhotoSync } from '../data/photoSync';
import { startNewsSync } from '../data/newsSync';
import { startWeatherSync } from '../data/weatherSync';
import { startFamilySync } from '../data/familySync';
import { startListSync } from '../data/listSync';
import { startGrocerySync } from '../data/grocerySync';
import { startTaskSync } from '../data/taskSync';
import { startPush } from '../data/push';
import { startCalendarSync } from '../data/calendarSync';
import { checkGoogleReturn } from '../views/calendar/CalendarSettings';
import { openThemeSheet } from './ThemeSheet';
import { THEMES, useApplyTheme, useTheme } from './theme';
import { IS_KIOSK, isPhone, useLayout, viewportSize } from './layout';
import { VIEWS, closeSheet, go, goFromHash, idleTick, resetIdle, setMode, ui, useUI, type ViewName } from './ui';
import css from './App.module.css';

const SCREENS: Record<ViewName, { label: string; icon: IconName; component: ComponentType<{ active: boolean }> }> = {
  home: { label: 'Today', icon: 'home', component: Home },
  calendar: { label: 'Calendar', icon: 'calendar', component: Calendar },
  tasks: { label: 'Tasks', icon: 'tasks', component: Tasks },
  lists: { label: 'Lists', icon: 'list', component: Lists },
  kitchen: { label: 'Kitchen', icon: 'recipe', component: Kitchen },
  news: { label: 'News', icon: 'news', component: News },
  photos: { label: 'Photos', icon: 'photo', component: Photos },
};

/** Phone tab bar: these get their own tab; the rest sit under "More" (in their usual order) */
const PHONE_TABS: readonly ViewName[] = ['home', 'calendar', 'tasks'];
const PHONE_MORE: readonly ViewName[] = VIEWS.filter((v) => !PHONE_TABS.includes(v));

const SHOW_DIAG = diagEnabled();

export function App() {
  useApplyTheme();
  const view = useUI((s) => s.view);
  const mode = useUI((s) => s.mode);
  const phone = useLayout() === 'phone';
  const stage = useRef<HTMLDivElement>(null);
  useStageFit(stage, phone);
  useIdle();
  const ptr = useRef<HTMLDivElement>(null);
  usePullToRefresh(phone, ptr);

  useEffect(startFamilySync, []);
  useEffect(startPhotoSync, []);
  useEffect(startNewsSync, []);
  useEffect(startWeatherSync, []);
  useEffect(startListSync, []);
  useEffect(startGrocerySync, []);
  useEffect(startTaskSync, []);
  useEffect(startPush, []);
  useEffect(startCalendarSync, []);
  useEffect(startKitchenSync, []);
  useEffect(checkGoogleReturn, []);
  useEffect(checkSharedRecipe, []);
  // Photos shared to the installed app from another app (public/sw.js)
  useEffect(() => { if (!IS_KIOSK) void receiveSharedPhotos(); }, []);

  useEffect(() => {
    window.addEventListener('hashchange', goFromHash);
    document.addEventListener('pointerdown', resetIdle, true);
    return () => {
      window.removeEventListener('hashchange', goFromHash);
      document.removeEventListener('pointerdown', resetIdle, true);
    };
  }, []);

  return (
    <div className={css.stage} id="stage" data-mode={mode} ref={stage}>
      {!phone && <Rail view={view} />}
      {/* Every screen stays mounted (hidden with content-visibility), so switching tabs only paints */}
      <main className={css.views}>
        {VIEWS.map((v) => {
          const Screen = SCREENS[v].component;
          return (
            <section key={v} className={css.view + (v === 'photos' ? ' ' + css.bleed : '') + (v === view ? ' ' + css.isActive : '')} id={'view-' + v} data-view={v}>
              <Screen active={v === view} />
            </section>
          );
        })}
      </main>
      {phone && <TabBar view={view} />}
      {phone && (
        <div className={css.ptr} ref={ptr} aria-hidden="true">
          <Icon name="refresh" size={22} />
        </div>
      )}
      <Toasts />
      <SheetHost />
      <Ambient active={mode === 'ambient'} />
      <Sleep />
      {SHOW_DIAG && <Diag />}
    </div>
  );
}

function Rail({ view }: { view: ViewName }) {
  const theme = THEMES[useTheme()];
  const now = useNow();
  return (
    <nav className={css.rail} aria-label="Sections">
      <span className={css.logo} role="img" aria-label="White Lotus HQ" />
      {VIEWS.map((v) => (
        <button
          key={v}
          className={css.item + (v === view ? ' ' + css.isActive : '')}
          // Switch the instant a finger lands, not on release; keyboard "clicks" (detail 0) still work
          onPointerDown={(e) => { if (e.button === 0) go(v); }}
          onClick={(e) => { if (e.detail === 0) go(v); }}
        >
          <Icon name={SCREENS[v].icon} size={26} />
          <span>{SCREENS[v].label}</span>
        </button>
      ))}
      <button className={css.item + ' ' + css.theme} aria-label="Choose a colour theme" onClick={openThemeSheet}>
        <Icon name={theme.icon} size={24} />
        <span>{theme.label}</span>
      </button>
      <div className={css.clock}>
        <b>{fmt.time(now, false)}</b>
        <span>{fmt.ampm(now)}</span>
      </div>
    </nav>
  );
}

/**
 * Phone navigation: Today, Calendar and Tasks have tabs; "More" opens a small menu with the rest.
 * The active tab is marked by a pill behind its icon.
 */
function TabBar({ view }: { view: ViewName }) {
  const [menu, setMenu] = useState(false);
  const inMore = PHONE_MORE.includes(view);

  const tap = (v: ViewName) => {
    setMenu(false);
    if (v !== view) return go(v);
    // Tapping the current tab again scrolls it back to the top
    document.querySelectorAll<HTMLElement>(`#view-${v}, #view-${v} [data-scroll-top]`).forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);

  const tab = (v: ViewName) => (
    <button key={v} className={css.tab + (v === view ? ' ' + css.isActive : '')} aria-current={v === view ? 'page' : undefined} onClick={() => tap(v)}>
      <span className={css.tabInd}>
        <Icon name={SCREENS[v].icon} size={24} />
      </span>
      <span>{SCREENS[v].label}</span>
    </button>
  );

  return (
    <>
      {menu && (
        <div className={css.menuLayer} onClick={() => setMenu(false)}>
          <div className={css.menu} role="menu" onClick={(e) => e.stopPropagation()}>
            {PHONE_MORE.map((v) => (
              <button key={v} role="menuitem" className={css.menuItem + (v === view ? ' ' + css.isActive : '')} onClick={() => tap(v)}>
                <Icon name={SCREENS[v].icon} size={22} />
                {SCREENS[v].label}
                {v === view && <Icon name="check" size={18} className={css.menuCheck} />}
              </button>
            ))}
          </div>
        </div>
      )}
      <nav className={css.tabbar} aria-label="Sections">
        {PHONE_TABS.map(tab)}
        <button
          className={css.tab + (inMore || menu ? ' ' + css.isActive : '')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <span className={css.tabInd}>
            <Icon name="more" size={24} className="i--fill" />
          </span>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}

/**
 * Phone pull-to-refresh: pulling a screen down from its top reloads the app (fresh data, and the
 * latest version after a deploy). Installed web apps don't get the browser's own pull-to-refresh.
 */
function usePullToRefresh(enabled: boolean, indicator: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!enabled) return;
    const views = document.querySelector<HTMLElement>('.' + css.views);
    const ind = indicator.current;
    if (!views || !ind) return;

    const PULL = 80; // px of (dampened) pull that triggers a refresh
    let start: { x: number; y: number } | null = null, pull = 0, active = false;

    /** The scrolled element the touch is in: it must be at its top for a pull to start */
    const scrollerAt = (el: Element | null): HTMLElement | null => {
      for (let n = el as HTMLElement | null; n && n !== views; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    };
    const show = (d: number) => {
      ind.style.transform = `translateY(${Math.min(d, PULL * 1.4)}px) rotate(${d * 3}deg)`;
      ind.style.opacity = String(Math.min(1, d / PULL));
      ind.classList.toggle(css.isReady, d >= PULL);
    };
    const reset = () => {
      start = null; pull = 0; active = false;
      ind.style.transition = 'transform .2s, opacity .2s';
      show(0);
      setTimeout(() => { ind.style.transition = ''; }, 200);
    };

    const onStart = (e: TouchEvent) => {
      const sc = scrollerAt(e.target as Element);
      start = e.touches.length === 1 && (!sc || sc.scrollTop <= 0) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      // A photo being dragged to a new spot isn't a pull
      if (document.querySelector('[data-dragging]')) return reset();
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
      if (!active) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        // Only a downward, mostly vertical pull; anything else is left to scrolling and swiping
        if (dy <= 0 || Math.abs(dx) > dy) { start = null; return; }
        active = true;
      }
      if (e.cancelable) e.preventDefault();
      pull = Math.max(0, dy) * 0.5;
      show(pull);
    };
    const onEnd = () => {
      if (active && pull >= PULL) {
        ind.classList.add(css.isLoading);
        location.reload();
        return;
      }
      if (active) reset(); else start = null;
    };

    views.addEventListener('touchstart', onStart, { passive: true });
    views.addEventListener('touchmove', onMove, { passive: false });
    views.addEventListener('touchend', onEnd);
    views.addEventListener('touchcancel', reset);
    return () => {
      views.removeEventListener('touchstart', onStart);
      views.removeEventListener('touchmove', onMove);
      views.removeEventListener('touchend', onEnd);
      views.removeEventListener('touchcancel', reset);
      ind.classList.remove(css.isReady, css.isLoading);
    };
  }, [enabled]);
}

/**
 * Designed at 1280×800. Screens wider than 16:10 (e.g. 1920×1080 frames) widen the stage to their
 * aspect instead of pillarboxing; narrower screens letterbox.
 */
function useStageFit(ref: RefObject<HTMLDivElement | null>, phone: boolean) {
  useLayoutEffect(() => {
    // The phone layout fills the screen as is (see .stage in App.module.css)
    if (phone) {
      ref.current?.style.removeProperty('--stage-w');
      if (ref.current) ref.current.style.transform = '';
      return;
    }
    const STAGE_H = 800, STAGE_MIN_W = 1280;
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      // The visible area, not innerWidth/innerHeight: those follow the layout viewport, which grows
      // to fit content that overflows it. The stage itself overflows before its scale applies, so
      // the Skylight Calendar 2 (WebView 124, 1280×720) reported 1315×740 and the stage spilled off
      // both edges. In local dev, the frame-sized preview box (layout.ts).
      const { w: vw, h: vh } = viewportSize();
      const w = Math.max(STAGE_MIN_W, Math.round((STAGE_H * vw) / vh));
      el.style.setProperty('--stage-w', w + 'px');
      const s = Math.min(vw / w, vh / STAGE_H);
      el.style.transform = Math.abs(s - 1) < 0.01 ? '' : `scale(${s})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ref, phone]);
}

/**
 * No touch for two minutes: the photo frame, or during the sleep hours a black screen with the
 * backlight down. The photo frame turns into the sleep screen when the sleep hours start, and back
 * when they end. The current screen stays put underneath, so waking returns to it.
 */
/** Seconds without a touch before the photo frame takes over */
const IDLE_AFTER = 120;

function useIdle() {
  useEffect(() => {
    const t = setInterval(() => {
      // Phones don't turn into a photo frame when left alone
      if (isPhone()) return;
      const s = ui.get();
      const sec = idleTick();
      const sleepy = isSleepTime(clockNow());
      if (s.mode === 'ambient' && sleepy) return setMode('sleep');
      if (s.mode === 'sleep' && !sleepy) return setMode('ambient');
      if (s.mode === 'day' && sec >= IDLE_AFTER) {
        closeSheet();
        setMode(sleepy ? 'sleep' : 'ambient');
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // The kiosk dims the backlight while the sleep screen is up
  const sleeping = useUI((s) => s.mode === 'sleep');
  useEffect(() => setBacklight(sleeping ? 0 : -1), [sleeping]);
}
