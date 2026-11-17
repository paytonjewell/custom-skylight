// Small helpers every API handler shares, so requests are read and answered the same way everywhere.

/** A JSON answer. Never cached: the data changes from every device. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** An error the app can show ({ error }) */
export const bad = (error: string, status = 400) => json({ error }, status);
export const notFound = (error: string) => bad(error, 404);

/** Saved; nothing to send back */
export const done = () => new Response(null, { status: 204 });

/** The request's JSON body, or null when it isn't JSON */
export const readJson = <T>(req: Request) => req.json<T>().catch(() => null);

export const now = () => new Date().toISOString();

// The `*` parts of a path with the pattern's shape, when each passes `ok`: '/api/lists/ab12cd34/items'
// against '/api/lists/*/items' gives ['ab12cd34']. Null for any other path. `ok` sees each part with
// its place among the `*`s, so ids and days can be checked differently.
export function pathParts(
  path: string,
  pattern: string,
  ok: (part: string, index: number) => boolean,
): string[] | null {
  const got = path.split('/'),
    want = pattern.split('/');
  if (got.length !== want.length) return null;
  const out: string[] = [];
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== '*') {
      if (got[i] !== want[i]) return null;
    } else if (got[i] && ok(got[i], out.length)) out.push(got[i]);
    else return null;
  }
  return out;
}
