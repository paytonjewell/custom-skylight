// "Update available" for the phone app (src/data/appUpdate.ts). Shown only in the app, when a newer
// build has been published; Install downloads it and Android asks to confirm.
import { Icon } from '../ui/Icon';
import { dismissUpdate, installUpdate, useAppUpdate } from '../data/appUpdate';
import css from './UpdateBanner.module.css';

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

export function UpdateBanner() {
  const available = useAppUpdate((s) => s.available);
  const phase = useAppUpdate((s) => s.phase);
  const progress = useAppUpdate((s) => s.progress);
  const dismissed = useAppUpdate((s) => s.dismissed);
  if (!available || (dismissed === available.versionCode && phase === 'idle')) return null;

  const busy = phase !== 'idle';
  const sub =
    phase === 'downloading'
      ? `Downloading… ${Math.round(progress * 100)}%`
      : phase === 'confirm'
        ? 'Tap Update on the next screen'
        : `Version ${available.versionName} · ${mb(available.size)}`;
  return (
    <div className={css.banner} role="status">
      <Icon name="download" size={22} />
      <div className={css.text}>
        <b>Update available</b>
        <span>{sub}</span>
      </div>
      <button className={css.install} onClick={() => void installUpdate()} disabled={busy}>
        {busy ? 'Installing' : 'Install'}
      </button>
      {!busy && (
        <button className={css.close} aria-label="Not now" onClick={dismissUpdate}>
          <Icon name="x" size={20} />
        </button>
      )}
      {phase === 'downloading' && <div className={css.bar} style={{ width: progress * 100 + '%' }} />}
    </div>
  );
}
