// The only page a signed-out device can see. Self-contained (no app assets, which are gated too).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A starting name for the device, from its user agent; editable on the form */
function guessName(ua: string): string {
  if (/; wv\)/.test(ua)) return 'Frame';
  if (/Android|iPhone|iPad/.test(ua)) return 'Phone';
  return 'Computer';
}

export function signInPage(req: Request, opts: { error?: string; name?: string; status?: number } = {}): Response {
  const name = opts.name ?? guessName(req.headers.get('User-Agent') ?? '');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>White Lotus HQ</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="icon" href="/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root { color-scheme: light dark; --bg: #F1F1F1; --card: #fff; --ink: #1F1E24; --ink-2: #5E5C66; --line: #DEDDE3; --err: #B3261E; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17161B; --card: #222128; --ink: #F2F1F5; --ink-2: #A9A7B2; --line: #3A3842; --err: #F2B8B5; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--ink);
    font: 17px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  form { width: 100%; max-width: 380px; background: var(--card); border-radius: 24px; padding: 32px 28px; box-shadow: 0 12px 40px rgba(0,0,0,.08); }
  h1 { margin: 0 0 6px; font: 600 30px/1.1 Georgia, serif; }
  p { margin: 0 0 22px; color: var(--ink-2); }
  label { display: block; font-size: 14px; font-weight: 600; margin: 16px 0 6px; color: var(--ink-2); }
  input { width: 100%; height: 56px; padding: 0 16px; border-radius: 14px; border: 1px solid var(--line); background: transparent; color: inherit; font: inherit; font-size: 20px; }
  input[name=pin] { letter-spacing: .3em; }
  button { width: 100%; height: 56px; margin-top: 24px; border: 0; border-radius: 999px; background: var(--ink); color: var(--bg); font: inherit; font-weight: 600; }
  .err { margin: 16px 0 0; color: var(--err); font-weight: 500; }
</style>
</head>
<body>
<form method="post" action="/signin">
  <h1>White Lotus HQ</h1>
  <p>Enter the PIN to use this device. You'll stay signed in.</p>
  <label for="pin">PIN</label>
  <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus>
  <label for="name">Name this device</label>
  <input id="name" name="name" value="${esc(name)}" maxlength="40" autocomplete="off">
  ${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
  <button type="submit">Sign in</button>
</form>
</body>
</html>`;
  return new Response(html, {
    status: opts.status ?? 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
