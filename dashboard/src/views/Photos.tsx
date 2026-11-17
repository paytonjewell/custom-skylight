// Photos: a grid of every photo (tap to view or delete, hold and drag to reorder), with a preview of
// the idle photo frame. Photos are added from a phone; the frame only views, reorders and deletes.
import { useEffect, useRef, useState } from "react";
import type { Photo } from "../data/types";
import { useData } from "../data/store";
import { addPhotos, deletePhoto, reorderPhotos } from "../data/actions";
import { usePhotoStatus } from "../data/photoSync";
import { photoSrc } from "../data/select";
import { fmt, pluralize } from "../lib/fmt";
import { go, openSheet, toast, useUI } from "../app/ui";
import { createStore, useStore } from "../lib/store";
import { IS_KIOSK, useLayout } from "../app/layout";
import { EmptyNote } from "../ui/EmptyNote";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/headers";
import { useHoldReorder } from "../ui/useHoldReorder";
import { PhotoFrame } from "./PhotoFrame";
import { useSwipeNav, type SlideshowHandle } from "./Slideshow";
import css from "./Photos.module.css";

export function Photos({ active }: { active: boolean }) {
  const [previewing, setPreviewing] = useState(false);
  const idle = useUI((s) => s.mode !== "day");

  // Leaving the screen, or the real photo frame (or night clock) taking over, ends the preview,
  // so coming back always starts at the grid
  useEffect(() => {
    if (!active || idle) setPreviewing(false);
  }, [active, idle]);

  return previewing ? (
    <Preview active={active} onExit={() => setPreviewing(false)} />
  ) : (
    <Grid onPreview={() => setPreviewing(true)} />
  );
}

function Grid({ onPreview }: { onPreview: () => void }) {
  const photos = useData().photos;
  const status = usePhotoStatus();
  const view = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const { order, ghost, itemProps } = useHoldReorder({
    ids: photos.map((p) => p.id),
    onCommit: reorderPhotos,
    container: view,
    scroller: grid,
  });
  const byId = new Map(photos.map((p) => [p.id, p]));
  // The slideshow preview shows how the wall frame will look, so it's only offered there
  const phone = useLayout() === "phone";

  const kicker =
    status === "loading"
      ? "Loading photos…"
      : status === "error"
        ? "Couldn’t load photos"
        : `${photos.length} ${pluralize(photos.length, "photo")}`;

  return (
    <div className={css.gridView} ref={view}>
      <PageHeader kicker={kicker} title="Photos">
        {/* Adding happens from a phone (or a computer), not on the frame itself */}
        {!IS_KIOSK && <AddButton primary={phone} />}
        {!phone && (
          <button
            className="btn btn--solid"
            onClick={onPreview}
            disabled={!photos.length}
          >
            <Icon name="photo" size={22} />
            Preview slideshow
          </button>
        )}
      </PageHeader>
      {status === "ready" && !photos.length ? (
        <EmptyNote large className={css.empty}>
          No photos yet.{" "}
          <i>
            {IS_KIOSK
              ? "Add some from your phone."
              : "Add some with the button above."}
          </i>
        </EmptyNote>
      ) : (
        <div
          className={css.grid}
          data-dragging={ghost ? "" : undefined}
          ref={grid}
          data-scroll-top
        >
          {order.map((id) => {
            const p = byId.get(id);
            return p ? (
              <div
                key={id}
                className={
                  css.tile + (ghost?.id === id ? " " + css.isLifted : "")
                }
                {...itemProps(id)}
                onClick={() => openPhotoSheet(p)}
              >
                <Thumb id={id} />
              </div>
            ) : null;
          })}
        </div>
      )}
      {ghost && (
        <div
          className={css.tile + " " + css.ghost}
          style={{
            left: ghost.x,
            top: ghost.y,
            width: ghost.w,
            height: ghost.h,
          }}
        >
          <Thumb id={ghost.id} />
        </div>
      )}
    </div>
  );
}

const Thumb = ({ id }: { id: string }) => (
  <img
    src={photoSrc(id, "thumb")}
    alt=""
    draggable={false}
    loading="lazy"
    onError={(e) => e.currentTarget.classList.add("is-broken")}
  />
);

// ------------------------------------------------------------ adding photos (button and share sheet)
/** [done, total] while photos are being added, else null */
const uploads = createStore<[number, number] | null>(null);
let queue: Promise<void> = Promise.resolve();

/** Add photos (resized, duplicates skipped), one batch at a time, then say how it went */
export function importPhotos(files: File[]): Promise<void> {
  if (!files.length) return queue;
  queue = queue.then(async () => {
    uploads.set([0, files.length]);
    const { added, failed, skipped } = await addPhotos(files, (done, total) =>
      uploads.set([done, total]),
    );
    uploads.set(null);
    const parts = [
      added || (!failed && !skipped)
        ? `Added ${added} ${pluralize(added, "photo")}`
        : "",
      skipped ? `${skipped} already added` : "",
      failed ? `${failed} couldn’t be added` : "",
    ].filter(Boolean);
    toast(parts.join(" · "), { icon: failed ? "x" : "check" });
  });
  return queue;
}

/**
 * Photos shared to the installed app ("Share → White Lotus HQ") wait in a cache on this phone, put there by
 * the service worker (public/sw.js). Add them, then clear them out. Checked at every start, so a
 * share made while signed out is picked up after signing in.
 */
let receiving = false;
export async function receiveSharedPhotos(): Promise<void> {
  if (receiving || !("caches" in window)) return;
  receiving = true;
  try {
    await receiveInbox();
  } finally {
    receiving = false;
  }
}

async function receiveInbox(): Promise<void> {
  const inbox = await caches.open("share-inbox");
  const keys = await inbox.keys();
  if (!keys.length) return;
  const files: File[] = [];
  for (const key of keys) {
    const res = await inbox.match(key);
    if (!res) continue;
    const blob = await res.blob();
    files.push(
      new File(
        [blob],
        decodeURIComponent(res.headers.get("X-Name") ?? "photo"),
        {
          type: blob.type,
          lastModified: Number(res.headers.get("X-Modified")) || Date.now(),
        },
      ),
    );
  }
  go("photos");
  toast(`Adding ${files.length} shared ${pluralize(files.length, "photo")}…`, {
    icon: "photo",
    ms: 3000,
  });
  await importPhotos(files);
  // Only cleared once added: if the app closes midway they're tried again (duplicates are skipped)
  await Promise.all(keys.map((k) => inbox.delete(k)));
}

function AddButton({ primary }: { primary?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const progress = useStore(uploads, (u) => u);
  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (input.current) input.current.value = "";
    void importPhotos(list);
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => pick(e.currentTarget.files)}
      />
      <button
        className={"btn" + (primary ? " btn--solid" : "")}
        onClick={() => input.current?.click()}
        disabled={!!progress}
      >
        <Icon name="plus" size={22} />
        {progress
          ? `Adding ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}…`
          : "Add photos"}
      </button>
    </>
  );
}

function openPhotoSheet(p: Photo): void {
  openSheet((close) => <PhotoSheet p={p} close={close} />, {
    cls: "sheet--wide " + css.sheet,
  });
}

function PhotoSheet({ p, close }: { p: Photo; close: () => void }) {
  const taken = p.taken ? new Date(p.taken) : null;
  return (
    <div>
      <div className={css.sheetImg}>
        <img src={photoSrc(p.id)} alt="" />
      </div>
      <div className={css.sheetFoot}>
        <div className={css.sheetMeta}>
          <b>
            {taken
              ? `${fmt.month(taken)} ${taken.getDate()}, ${taken.getFullYear()}`
              : "Date unknown"}
          </b>
          {p.by && <span>Added by {p.by}</span>}
        </div>
        <button
          className="btn btn--danger"
          onClick={() => {
            close();
            deletePhoto(p.id);
          }}
        >
          <Icon name="x" size={22} />
          Delete photo
        </button>
      </div>
    </div>
  );
}

/** The idle photo frame as it will look (minus countdowns), with controls on top */
function Preview({ active, onExit }: { active: boolean; onExit: () => void }) {
  const show = useRef<SlideshowHandle>(null);
  const [chrome, setChrome] = useState(false); // Exit button, shown by tapping the middle

  // One surface handles both: drag sideways to pull the next photo in (as on the frame); tap the
  // edges to step, tap the middle to show or hide the Exit button.
  const swipe = useSwipeNav(show, (e) => {
    const r = e.currentTarget.getBoundingClientRect(),
      f = (e.clientX - r.left) / r.width;
    if (f < 0.22) show.current?.prev();
    else if (f > 0.78) show.current?.next();
    else setChrome((c) => !c);
  });

  return (
    <div className={css.preview}>
      <PhotoFrame active={active} slideshowRef={show} />
      <div className={css.surface} {...swipe} />
      <button
        className={css.btn + " " + css.arrow + " " + css.arrowLeft}
        aria-label="Previous"
        onClick={() => show.current?.prev()}
      >
        <Icon name="left" size={30} />
      </button>
      <button
        className={css.btn + " " + css.arrow + " " + css.arrowRight}
        aria-label="Next"
        onClick={() => show.current?.next()}
      >
        <Icon name="right" size={30} />
      </button>
      {chrome && (
        <div className={css.top}>
          <button className={css.btn} onClick={onExit}>
            <Icon name="x" size={26} />
            <span>Exit slideshow</span>
          </button>
        </div>
      )}
    </div>
  );
}
