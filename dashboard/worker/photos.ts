// Photo API. Files live in R2 (photos/<id>/full.jpg, thumb.jpg); the list and order live in D1.
// Uploads arrive already resized by the browser (src/data/upload.ts), so the frame never has to
// decode a full-size camera original.
import type { Photo } from '../src/data/types';
import type { Device } from './auth';

const MAX_FULL = 12 * 1024 * 1024;
const MAX_THUMB = 2 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/webp', 'image/png']);
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

interface Row {
  id: string;
  width: number;
  height: number;
  taken_at: string | null;
  added_by: string | null;
  added_at: string;
}

const toPhoto = (r: Row): Photo => ({
  id: r.id,
  w: r.width,
  h: r.height,
  o: r.height > r.width ? 'p' : 'l',
  taken: r.taken_at,
  by: r.added_by,
  added: r.added_at,
});

const key = (id: string, size: 'full' | 'thumb') => `photos/${id}/${size}.jpg`;
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const bad = (error: string, status = 400) => json({ error }, status);

/** GET /api/photos */
export async function listPhotos(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, width, height, taken_at, added_by, added_at FROM photos ORDER BY position, added_at',
  ).all<Row>();
  return json(results.map(toPhoto));
}

/** POST /api/photos/known ({ hashes: [...] }): which of these original-file fingerprints are already added */
export async function knownPhotos(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ hashes?: unknown }>().catch(() => null);
  const hashes = body?.hashes;
  if (!Array.isArray(hashes) || hashes.length > 500 || !hashes.every((h) => typeof h === 'string' && HASH.test(h)))
    return bad('Expected { hashes: [...] }');
  if (!hashes.length) return json({ known: [] });
  const { results } = await env.DB.prepare(
    `SELECT source_hash FROM photos WHERE source_hash IN (${hashes.map(() => '?').join(',')})`,
  )
    .bind(...hashes)
    .all<{ source_hash: string }>();
  return json({ known: results.map((r) => r.source_hash) });
}

/** POST /api/photos (multipart: full, thumb, width, height, takenAt?, sourceHash?). 409 if already added. */
export async function addPhoto(req: Request, env: Env, device: Device): Promise<Response> {
  const form = await req.formData();
  const full = form.get('full'),
    thumb = form.get('thumb');
  if (!(full instanceof File) || !(thumb instanceof File)) return bad('Expected "full" and "thumb" image files');
  if (!TYPES.has(full.type) || !TYPES.has(thumb.type)) return bad('Images must be JPEG, WebP or PNG');
  if (full.size > MAX_FULL || thumb.size > MAX_THUMB) return bad('Image too large', 413);
  const width = Number(form.get('width')),
    height = Number(form.get('height'));
  const dim = (n: number) => Number.isInteger(n) && n > 0 && n <= 10000;
  if (!dim(width) || !dim(height)) return bad('Bad width/height');
  const takenRaw = String(form.get('takenAt') ?? '');
  const taken = takenRaw && !Number.isNaN(Date.parse(takenRaw)) ? new Date(takenRaw).toISOString() : null;
  const hashRaw = String(form.get('sourceHash') ?? '');
  const sourceHash = HASH.test(hashRaw) ? hashRaw : null;
  const duplicate = () => json({ error: 'Already added' }, 409);
  if (sourceHash && (await env.DB.prepare('SELECT 1 FROM photos WHERE source_hash = ?').bind(sourceHash).first()))
    return duplicate();

  const id = crypto.randomUUID();
  await Promise.all([
    env.PHOTOS.put(key(id, 'full'), full.stream(), { httpMetadata: { contentType: full.type } }),
    env.PHOTOS.put(key(id, 'thumb'), thumb.stream(), { httpMetadata: { contentType: thumb.type } }),
  ]);
  const row: Row = { id, width, height, taken_at: taken, added_by: device.name, added_at: new Date().toISOString() };
  try {
    // New photos go first, so they show at the top of the grid and come up next in the slideshow
    await env.DB.prepare(
      'INSERT INTO photos (id, width, height, taken_at, added_by, added_at, source_hash, position) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM photos))',
    )
      .bind(row.id, row.width, row.height, row.taken_at, row.added_by, row.added_at, sourceHash)
      .run();
  } catch (e) {
    await env.PHOTOS.delete([key(id, 'full'), key(id, 'thumb')]);
    // The same photo uploaded twice at once: the unique index caught the second
    if (sourceHash && String(e).includes('UNIQUE')) return duplicate();
    throw e;
  }
  return json(toPhoto(row), 201);
}

/** DELETE /api/photos/:id */
export async function deletePhoto(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  await env.PHOTOS.delete([key(id, 'full'), key(id, 'thumb')]);
  return meta.changes ? new Response(null, { status: 204 }) : bad('No such photo', 404);
}

/** PUT /api/photos/order ({ ids: [...] } in display order) */
export async function reorderPhotos(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ ids?: unknown }>().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length > 10000 || !ids.every((x) => typeof x === 'string' && ID.test(x)))
    return bad('Expected { ids: [...] }');
  if (ids.length) {
    const stmt = env.DB.prepare('UPDATE photos SET position = ? WHERE id = ?');
    await env.DB.batch(ids.map((id, i) => stmt.bind(i, id)));
  }
  return new Response(null, { status: 204 });
}

/** GET /media/:id/(full|thumb) — private and immutable (an id's image never changes) */
export async function servePhoto(req: Request, env: Env, id: string, size: 'full' | 'thumb'): Promise<Response> {
  const obj = await env.PHOTOS.get(key(id, size), { onlyIf: req.headers });
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers({ ETag: obj.httpEtag, 'Cache-Control': 'private, max-age=31536000, immutable' });
  obj.writeHttpMetadata(headers);
  // With If-None-Match matching, R2 returns the object without a body
  return 'body' in obj ? new Response(obj.body, { headers }) : new Response(null, { status: 304, headers });
}
