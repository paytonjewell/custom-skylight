// The phone app's own updates (dashboard/android). GitHub Actions builds a signed APK whenever the
// native app changes and uploads it here (.github/workflows/android.yml); the app asks which version
// is newest and, when it's behind, offers to download and install it (src/data/appUpdate.ts).
//
// One R2 object holds the newest APK, its version in the object's metadata, so the version and the
// file can never disagree. Only the app's download and version check sit behind the PIN; the upload
// is outside it (CI has no device cookie) and needs APP_UPLOAD_TOKEN instead.
import type { AppRelease } from '../src/data/types';
import { sha256 } from './hash';
import { bad, done, json } from './http';

const KEY = 'app/white-lotus-hq.apk';
const MAX_BYTES = 60 * 1024 * 1024;

/** GET /api/app: the newest build, or null before the first upload */
export async function getAppRelease(env: Env): Promise<Response> {
  const head = await env.PHOTOS.head(KEY);
  return json<AppRelease | null>(head ? release(head) : null);
}

function release(obj: R2Object): AppRelease {
  const m = obj.customMetadata ?? {};
  return {
    versionCode: Number(m.versionCode) || 0,
    versionName: m.versionName ?? '',
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  };
}

/** GET /api/app/apk: the newest APK itself */
export async function serveApk(env: Env): Promise<Response> {
  const obj = await env.PHOTOS.get(KEY);
  if (!obj) return bad('No app build yet', 404);
  const { versionName } = release(obj);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(obj.size),
      'Content-Disposition': `attachment; filename="white-lotus-hq-${versionName || 'latest'}.apk"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * PUT /api/app/upload?versionCode=57&versionName=1.0.57, body = the APK, with
 * `Authorization: Bearer <APP_UPLOAD_TOKEN>`. An older version than the one already here is refused,
 * so re-running an old build can't take phones backwards.
 */
export async function uploadApk(req: Request, env: Env): Promise<Response> {
  const secret = env.APP_UPLOAD_TOKEN ?? '';
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  // Compare digests in constant time, as the PIN check does (worker/auth.ts)
  if (secret.length < 32 || !crypto.subtle.timingSafeEqual(await sha256(given), await sha256(secret)))
    return bad('Not allowed', 403);

  const url = new URL(req.url);
  const versionCode = Number(url.searchParams.get('versionCode'));
  const versionName = (url.searchParams.get('versionName') ?? '').slice(0, 40);
  if (!Number.isInteger(versionCode) || versionCode < 1) return bad('versionCode must be a whole number');

  const size = Number(req.headers.get('Content-Length'));
  if (!size || size > MAX_BYTES) return bad('The APK must come with a Content-Length under 60 MB');

  const current = await env.PHOTOS.head(KEY);
  if (current && versionCode < release(current).versionCode)
    return bad(`Version ${versionCode} is older than the one already published`, 409);

  const bytes = await req.arrayBuffer();
  // An APK is a zip file, which starts "PK"
  if (bytes.byteLength !== size || new Uint8Array(bytes, 0, 2).join() !== '80,75') return bad('That isn’t an APK');
  await env.PHOTOS.put(KEY, bytes, {
    httpMetadata: { contentType: 'application/vnd.android.package-archive' },
    customMetadata: { versionCode: String(versionCode), versionName },
  });
  return done();
}
