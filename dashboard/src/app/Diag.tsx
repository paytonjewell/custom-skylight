// On-device diagnostics overlay for checking performance on the frame.
// Enable with ?diag in the URL (remembered), turn off with ?diag=0.
// Experiments: ?diag&exp=font,shadow,img (comma separated) to rule out expensive rendering.
import { useEffect, useRef, useState } from 'react';
import { store, stored } from '../lib/store';
import { ui, useUI } from './ui';
import app from './App.module.css';
import css from './Diag.module.css';

const KEY = 'hq-diag';

export function diagEnabled(): boolean {
  const q = location.search.match(/[?&]diag(=([^&]*))?/);
  if (q) store(KEY, q[2] === '0' ? '0' : '1');
  return stored(KEY, '0') === '1';
}

const EXP = (location.search.match(/[?&]exp=([^&]*)/)?.[1] ?? '').split(',').filter(Boolean);
const EXP_CSS: Record<string, string> = {
  font: 'body, .serif, .num, button, input { font-family: sans-serif !important; }',
  shadow: '*, *::before, *::after { box-shadow: none !important; text-shadow: none !important; }',
  img: 'img { visibility: hidden !important; }',
};

interface Switch { view: string; total: number }

function ua() {
  const m = navigator.userAgent.match(/(Firefox|Chrome)\/(\d+)/);
  const android = navigator.userAgent.match(/Android ([\d.]+)/);
  return (m ? m[1] + ' ' + m[2] : navigator.userAgent.slice(0, 30)) + (android ? ' · Android ' + android[1] : '');
}

export function Diag() {
  const view = useUI((s) => s.view);
  const [, setTick] = useState(0);
  const frames = useRef<number[]>([]);
  const jank = useRef(0);
  const down = useRef<number | null>(null);
  const switches = useRef<Switch[]>([]);

  // Experiments + frame timing + finger-down timestamps + twice-a-second repaint of the panel
  useEffect(() => {
    const css = EXP.map((x) => EXP_CSS[x] ?? '').join('');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    let last = performance.now(), raf = 0;
    const frame = (t: number) => {
      const d = t - last;
      last = t;
      frames.current.push(d);
      if (d > 50) jank.current++;
      if (frames.current.length > 180) frames.current.shift();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onDown = (e: PointerEvent) => { if ((e.target as Element).closest('.' + app.rail)) down.current = performance.now(); };
    document.addEventListener('pointerdown', onDown, true);
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      style.remove();
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onDown, true);
      clearInterval(t);
    };
  }, []);

  // Screen switch: time from finger down on the sidebar to the next painted frame
  useEffect(() => {
    const start = down.current ?? performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      switches.current = [{ view, total: performance.now() - start }, ...switches.current].slice(0, 7);
      down.current = null;
    }));
  }, [view]);

  const fr = frames.current.slice(-90);
  const avg = fr.reduce((a, b) => a + b, 0) / (fr.length || 1);
  const stage = document.getElementById('stage');
  const scale = stage ? stage.getBoundingClientRect().height / 800 : 1;
  const imgs = Array.from(document.images).filter((i) => i.naturalWidth);
  const mpx = imgs.reduce((s, i) => s + i.naturalWidth * i.naturalHeight, 0) / 1e6;
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return (
    <div className={css.diag}>
      <b>DIAG</b> {ua()} · exp {EXP.join(',') || 'none'} · mode {ui.get().mode}
      <br />
      viewport {innerWidth}×{innerHeight} · dpr {devicePixelRatio} · scale {scale.toFixed(3)}
      <br />
      fps {(1000 / avg).toFixed(0)} · frame {avg.toFixed(0)}ms · jank&gt;50ms {jank.current}
      <br />
      dom {document.getElementsByTagName('*').length} · imgs {imgs.length} ({mpx.toFixed(1)} MP) · heap {mem ? Math.round(mem.usedJSHeapSize / 1048576) + ' MB' : 'n/a'}
      <br />
      <u>screen switch · tap → painted</u>
      {switches.current.map((s, i) => (
        <span key={i}>
          <br />
          {s.view} · <b>{Math.round(s.total)}ms</b>
        </span>
      ))}
    </div>
  );
}
