// Prepares a picked photo for upload: a display copy (≤1920px) and a grid thumbnail (≤640px), both
// JPEG, resized here on the phone so the frame never decodes a full-size camera original.

const FULL = 1920;
const THUMB = 640;
const QUALITY = 0.85;

export interface PreparedPhoto {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** When it was taken (ISO), from EXIF, else the file's date */
  takenAt: string;
}

/**
 * Fingerprint of the original file (SHA-256, hex), so a photo picked a second time is recognised.
 * Null where the browser won't hash (crypto.subtle needs HTTPS, e.g. the dev server over the LAN).
 */
export async function fileHash(file: File): Promise<string | null> {
  if (!crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  // createImageBitmap applies the EXIF rotation, so portrait phone photos come out upright
  const bmp = await createImageBitmap(file);
  try {
    const full = await encode(bmp, FULL);
    const thumb = await encode(bmp, THUMB);
    return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h, takenAt: await takenAt(file) };
  } finally {
    bmp.close();
  }
}

async function encode(bmp: ImageBitmap, max: number): Promise<{ blob: Blob; w: number; h: number }> {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Could not encode image');
  return { blob, w, h };
}

async function takenAt(file: File): Promise<string> {
  try {
    // Loaded only when adding photos, so the frame never downloads it
    const { default: exifr } = await import('exifr');
    const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const d = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // No EXIF (screenshots, edited copies): fall back to the file's date
  }
  return new Date(file.lastModified || Date.now()).toISOString();
}
