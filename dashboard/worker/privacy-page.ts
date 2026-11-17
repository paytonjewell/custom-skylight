// Public privacy policy (Google requires one, at a public link, to put the app's sign-in in production).
// Self-contained, like the sign-in page.

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>White Lotus HQ privacy</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: light dark; --bg: #F1F1F1; --card: #fff; --ink: #1F1E24; --ink-2: #5E5C66; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17161B; --card: #222128; --ink: #F2F1F5; --ink-2: #A9A7B2; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 17px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 680px; margin: 24px auto; background: var(--card); border-radius: 24px; padding: 32px 28px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  h2 { margin: 28px 0 6px; font-size: 19px; }
  p, li { color: var(--ink-2); }
  small { color: var(--ink-2); }
</style>
</head>
<body>
<main>
  <h1>White Lotus HQ privacy policy</h1>
  <small>Updated November 16, 2026</small>

  <p>White Lotus HQ is a private dashboard for one household. It is not offered to the public, and only
  devices that know the household's PIN can use it.</p>

  <h2>Google Calendar</h2>
  <p>When a household member connects their Google account, the dashboard uses Google's permission to:</p>
  <ul>
    <li>read the list of their calendars and the events on the calendars they choose to show;</li>
    <li>add, change and delete events when they do so on the dashboard.</li>
  </ul>
  <p>It keeps a copy of those events and the account's email address and sign-in token in the dashboard's
  own database, only to show the calendar. Nothing is sold, shared with anyone else, or used for
  advertising or for training AI models.</p>
  <p>White Lotus HQ's use of information received from Google APIs adheres to the
  <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
  including the Limited Use requirements.</p>

  <h2>Removing access</h2>
  <p>Disconnecting the account in the dashboard's Calendar settings deletes its token and copied events.
  Access can also be removed at any time at
  <a href="https://myaccount.google.com/connections">myaccount.google.com/connections</a>.</p>
</main>
</body>
</html>`;

export function privacyPage(): Response {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
