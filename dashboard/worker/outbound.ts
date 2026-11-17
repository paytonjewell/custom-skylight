// Fetching a link someone typed or shared (recipe import). The Worker must only ever reach the public
// web with it: not this machine, a private network, or a cloud metadata address, whether the link
// names one directly or a site redirects there.
//
// Addresses are checked as the URL parser leaves them: it already turns every way of writing an IPv4
// address (2130706433, 0x7f.1, 0177.0.0.1) into dotted decimal, so only that form needs checking.
// IPv6 literals are turned away outright; no recipe link is written that way, and it rules out every
// mapped and embedded IPv4 form at once. A public name that resolves to a private address can't be
// caught here (a Worker can't look up DNS itself), but Cloudflare's network doesn't route to those.

/** IPv4 ranges that aren't the public internet: [first octets, prefix length] */
const PRIVATE_V4: [number[], number][] = [
  [[0], 8], // "this network"
  [[10], 8],
  [[100, 64], 10], // carrier-grade NAT
  [[127], 8], // loopback
  [[169, 254], 16], // link-local, including cloud metadata
  [[172, 16], 12],
  [[192, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2], 24], // documentation
  [[192, 168], 16],
  [[198, 18], 15], // benchmarking
  [[198, 51, 100], 24], // documentation
  [[203, 0, 113], 24], // documentation
  [[224], 4], // multicast
  [[240], 4], // reserved, and broadcast
];

const v4 = (host: string): number | null => {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};

/** Whether a URL may be fetched: http(s), on a public host name or public IPv4 address */
export function isPublicUrl(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[')) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) return false;
  const ip = v4(host);
  if (ip === null) return !/^[\d.]+$/.test(host); // a name (an all-digit one would be a mangled address)
  return !PRIVATE_V4.some(([octets, bits]) => {
    const base = octets.reduce((a, o, i) => a | (o << (24 - 8 * i)), 0) >>> 0;
    const mask = (~0 << (32 - bits)) >>> 0;
    return (ip & mask) >>> 0 === (base & mask) >>> 0;
  });
}

const MAX_HOPS = 5;

/**
 * fetch(), following up to 5 redirects by hand so each new address is checked before it's fetched.
 * Throws for a link that isn't public (`NotPublic`) or a redirect loop; the final response's URL is `url`.
 */
export async function fetchPublic(start: URL, init: RequestInit = {}): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    if (!isPublicUrl(url)) throw new NotPublic(url.toString());
    const res = await fetch(url.toString(), { ...init, redirect: 'manual' });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
    if (!to) return { res, url };
    if (hop >= MAX_HOPS) throw new Error('Too many redirects');
    await res.body?.cancel();
    url = new URL(to, url);
  }
}

export class NotPublic extends Error {}
